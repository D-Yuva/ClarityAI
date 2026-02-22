import { Express } from 'express';
import { db } from './db';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { sendNotification } from './notifications';

import { checkFeeds } from './scheduler';

const parser = new Parser();

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

  // Get all channels
  app.get('/api/channels', (req, res) => {
    const channels = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all();
    res.json(channels);
  });

  // Add a channel
  app.post('/api/channels', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
      // 1. Try to find RSS URL
      let rssUrl = '';
      let channelName = '';

      // Helper to fetch and parse
      const fetchPage = async (u: string) => {
        const response = await fetch(u);
        const text = await response.text();
        return cheerio.load(text);
      };

      if (url.includes('youtube.com/feeds/videos.xml')) {
        rssUrl = url;
      } else {
        // Scrape the page for channelId
        const $ = await fetchPage(url);
        
        // Try to find channelId in meta tags
        const channelId = $('meta[itemprop="channelId"]').attr('content');
        
        if (channelId) {
          rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        } else {
           // Fallback: sometimes it's in a link tag
           const rssLink = $('link[type="application/rss+xml"]').attr('href');
           if (rssLink) rssUrl = rssLink;
        }
      }

      if (!rssUrl) {
        return res.status(400).json({ error: 'Could not find RSS feed for this channel. Please try the direct channel URL.' });
      }

      // 2. Verify RSS feed and get name
      const feed = await parser.parseURL(rssUrl);
      channelName = feed.title || 'Unknown Channel';

      // 3. Insert into DB
      const stmt = db.prepare('INSERT INTO channels (name, url, rss_url) VALUES (?, ?, ?)');
      const info = stmt.run(channelName, url, rssUrl);
      const channelId = info.lastInsertRowid as number;

      // Backfill existing videos so they aren't treated as new
      await backfillVideos(channelId, rssUrl);

      res.json({ id: channelId, name: channelName, url, rss_url: rssUrl });
    } catch (error: any) {
      console.error('Error adding channel:', error);
      res.status(500).json({ error: error.message || 'Failed to add channel' });
    }
  });

  // Delete channel
  app.delete('/api/channels/:id', (req, res) => {
    db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Get Videos/Summaries
  app.get('/api/videos', (req, res) => {
    try {
      const videos = db.prepare(`
        WITH RankedVideos AS (
          SELECT 
            v.*, 
            c.name as channel_name,
            ROW_NUMBER() OVER (PARTITION BY v.channel_id ORDER BY v.published_at DESC) as rn
          FROM videos v 
          JOIN channels c ON v.channel_id = c.id 
        )
        SELECT * FROM RankedVideos 
        WHERE rn <= 7 
        ORDER BY published_at DESC 
        LIMIT 100
      `).all();
      res.json(videos);
    } catch (error: any) {
      console.error('Error fetching videos:', error);
      res.status(500).json({ error: 'Failed to fetch videos from database.' });
    }
  });

  // Get Settings
  app.get('/api/settings', (req, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsObj: any = {};
    settings.forEach((s: any) => settingsObj[s.key] = s.value);
    res.json(settingsObj);
  });

  // Save Settings
  app.post('/api/settings', (req, res) => {
    const { 
      telegram_bot_token, telegram_chat_id
    } = req.body;
    
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    
    if (telegram_bot_token !== undefined) insert.run('telegram_bot_token', telegram_bot_token);
    if (telegram_chat_id !== undefined) insert.run('telegram_chat_id', telegram_chat_id);

    res.json({ success: true });
  });

  // Save Summary & Notify
  app.post('/api/videos/:id/summary', async (req, res) => {
    const { id } = req.params;
    const { summary } = req.body;

    if (!summary) return res.status(400).json({ error: 'Summary is required' });

    try {
      // 1. Update DB
      const stmt = db.prepare('UPDATE videos SET summary = ? WHERE id = ?');
      stmt.run(summary, id);

      // 2. Get Video Details for Notification
      const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id) as any;
      
      // 3. Send Notification (only if not already notified, or force it)
      // We'll assume if the client is saving a summary, they want a notification with it.
      // Check if we should notify (optional: check video.notified)
      
      if (video) {
        await sendNotification(video.title, video.link, summary);
        db.prepare('UPDATE videos SET notified = 1 WHERE id = ?').run(id);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error('Error saving summary:', error);
      res.status(500).json({ error: 'Failed to save summary' });
    }
  });

  // Test Notification
  app.post('/api/test-notification', async (req, res) => {
    try {
      const result = await sendNotification(
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

async function backfillVideos(channelId: number, rssUrl: string) {
  try {
    const feed = await parser.parseURL(rssUrl);
    const insertVideo = db.prepare(`
      INSERT OR IGNORE INTO videos 
      (channel_id, video_id, title, link, published_at, notified)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    const backfillTransaction = db.transaction((items) => {
      for (const item of items) {
        const videoId = item.id.split(':').pop();
        if (videoId && item.link && item.isoDate) {
          insertVideo.run(
            channelId,
            videoId,
            item.title,
            item.link,
            item.isoDate
          );
        }
      }
    });

    if (feed.items) {
      backfillTransaction(feed.items);
    }
    console.log(`Backfilled ${feed.items?.length || 0} videos for channel ${channelId}`);
  } catch (error) {
    console.error(`Error backfilling videos for channel ${channelId}:`, error);
    // Don't throw, as adding the channel is the primary goal
  }
}
