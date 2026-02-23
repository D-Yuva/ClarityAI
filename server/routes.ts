import { Express } from 'express';
import { supabase } from './db';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { sendNotification } from './notifications';
import { createClient } from '@supabase/supabase-js';

import { checkFeeds } from './scheduler';

const parser = new Parser();
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

// Helper to create an authenticated client using the user's JWT token
function getAuthClient(req: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return supabase; // Fallback to default client
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

export function setupRoutes(app: Express) {

  // Force Refresh Feeds
  app.post('/api/refresh', async (req, res) => {
    try {
      await checkFeeds();
      res.json({ success: true });
    } catch (error: any) {
      console.error('Manual refresh failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Get all channels (Proxy for backwards compatibility, frontend can now call Supabase directly)
  app.get('/api/channels', async (req, res) => {
    const client = getAuthClient(req);
    const { data: channels, error } = await client.from('channels').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(channels);
  });

  // Add a channel
  app.post('/api/channels', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const client = getAuthClient(req);

    // Get the user ID to associate the channel
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized: Please log in to add channels' });
    }

    try {
      // 1. Try to find RSS URL
      let rssUrl = '';
      let channelName = '';

      const fetchPage = async (u: string) => {
        const response = await fetch(u);
        const text = await response.text();
        return cheerio.load(text);
      };

      if (url.includes('youtube.com/feeds/videos.xml')) {
        rssUrl = url;
      } else {
        const $ = await fetchPage(url);
        const channelId = $('meta[itemprop="channelId"]').attr('content');
        if (channelId) {
          rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        } else {
          const rssLink = $('link[type="application/rss+xml"]').attr('href');
          if (rssLink) rssUrl = rssLink;
        }
      }

      if (!rssUrl) {
        return res.status(400).json({ error: 'Could not find RSS feed for this channel.' });
      }

      // 2. Verify RSS feed and get name
      const feed = await parser.parseURL(rssUrl);
      channelName = feed.title || 'Unknown Channel';

      // 3. Insert into DB using authenticated client (RLS automatically enforces user_id matching)
      const { data: channelData, error: insertError } = await client.from('channels').insert({
        user_id: user.id,
        name: channelName,
        url: url,
        rss_url: rssUrl
      }).select().single();

      if (insertError) throw new Error(insertError.message);
      const channelId = channelData.id;

      // Backfill existing videos so they aren't treated as new
      await backfillVideos(client, channelId, rssUrl);

      res.json(channelData);
    } catch (error: any) {
      console.error('Error adding channel:', error);
      res.status(500).json({ error: error.message || 'Failed to add channel' });
    }
  });

  // Delete channel
  app.delete('/api/channels/:id', async (req, res) => {
    const client = getAuthClient(req);
    const { error } = await client.from('channels').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Get Videos/Summaries
  app.get('/api/videos', async (req, res) => {
    const client = getAuthClient(req);
    try {
      // In Supabase, doing complex partition queries is harder via REST, 
      // so we use a view or just fetch top recent videos for the user.
      const { data: videos, error } = await client
        .from('videos')
        .select(`
          *,
          channels ( name )
        `)
        .order('published_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      // Transform response to match frontend expectations
      const formattedVideos = videos.map((v: any) => ({
        ...v,
        channel_name: v.channels?.name || 'Unknown'
      }));

      res.json(formattedVideos);
    } catch (error: any) {
      console.error('Error fetching videos:', error);
      res.status(500).json({ error: 'Failed to fetch videos from database.' });
    }
  });

  // Get Settings
  app.get('/api/settings', async (req, res) => {
    const client = getAuthClient(req);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: settings, error } = await client.from('user_settings').select('*').eq('user_id', user.id).single();
    if (error && error.code !== 'PGRST116') return res.status(500).json({ error: error.message });

    res.json(settings || {});
  });

  // Save Settings
  app.post('/api/settings', async (req, res) => {
    const client = getAuthClient(req);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { telegram_bot_token, telegram_chat_id } = req.body;

    const { error } = await client.from('user_settings').upsert({
      user_id: user.id,
      telegram_bot_token,
      telegram_chat_id
    });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // Save Summary
  app.post('/api/videos/:id/summary', async (req, res) => {
    const { id } = req.params;
    const { summary } = req.body;
    const client = getAuthClient(req);

    if (!summary) return res.status(400).json({ error: 'Summary is required' });

    try {
      // 1. Update DB
      const { error: updateError } = await client.from('videos').update({ summary }).eq('id', id);
      if (updateError) throw updateError;

      // 2. Get Video Details for Notification
      const { data: video, error: fetchError } = await client.from('videos').select('*, channels(user_id)').eq('id', id).single();
      if (fetchError || !video) throw new Error('Video not found');

      // 3. Send Notification
      const { data: userSettings } = await supabase.from('user_settings').select('*').eq('user_id', video.channels.user_id).single();

      if (userSettings && userSettings.telegram_bot_token && userSettings.telegram_chat_id && !video.notified) {
        await sendNotification(userSettings.telegram_bot_token, userSettings.telegram_chat_id, video.title, video.link, summary);
        await client.from('videos').update({ notified: true }).eq('id', id);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error saving summary:', error);
      res.status(500).json({ error: 'Failed to save summary' });
    }
  });

  // Test Notification
  app.post('/api/test-notification', async (req, res) => {
    const client = getAuthClient(req);
    const { data: { user } } = await client.auth.getUser();
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { data: userSettings } = await client.from('user_settings').select('*').eq('user_id', user.id).single();

      if (!userSettings || !userSettings.telegram_bot_token || !userSettings.telegram_chat_id) {
        return res.status(400).json({ error: 'Telegram settings not configured' });
      }

      const result = await sendNotification(
        userSettings.telegram_bot_token,
        userSettings.telegram_chat_id,
        'Test Notification',
        'https://example.com',
        'This is a test message to verify your Telegram settings.'
      );

      if (result && result.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: result?.error || 'Failed to send notification' });
      }
    } catch (error: any) {
      console.error('Test notification error:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

async function backfillVideos(client: any, channelId: string, rssUrl: string) {
  try {
    const feed = await parser.parseURL(rssUrl);

    if (feed.items) {
      const videos = feed.items.map(item => {
        const videoId = item.id.split(':').pop();
        return {
          channel_id: channelId,
          video_id: videoId || '',
          title: item.title,
          link: item.link,
          published_at: item.isoDate,
          notified: true // Mark backfilled as notified so we don't spam 100 historical messages
        };
      }).filter(v => v.video_id);

      // Upsert to handle ON CONFLICT DO NOTHING natively in Supabase via unique constraint
      if (videos.length > 0) {
        await client.from('videos').upsert(videos, { onConflict: 'channel_id, video_id', ignoreDuplicates: true });
      }
    }
    console.log(`Backfilled ${feed.items?.length || 0} videos for channel ${channelId}`);
  } catch (error) {
    console.error(`Error backfilling videos for channel ${channelId}:`, error);
  }
}
