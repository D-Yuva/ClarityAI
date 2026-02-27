import { Express } from 'express';
import { supabase } from './db';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { sendNotification } from './notifications';
import { createClient } from '@supabase/supabase-js';

import { checkFeeds } from './scheduler';

const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'mediaGroup']
    ]
  }
});
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

import { getTranscript } from './transcriber';
import { GoogleGenAI } from "@google/genai";

// Helper to create an authenticated client using the user's JWT token
function getAuthClient(req: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return supabase; // Fallback to default client
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

// Helper to set Telegram Webhook
async function setTelegramWebhook(botToken: string) {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_URL;
  if (!domain || !botToken) return;

  const webhookUrl = `https://${domain.replace(/^https?:\/\//, '')}/api/webhook/telegram`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}`);
    const data = await res.json();
    console.log('Telegram Webhook Registration:', data);
  } catch (err) {
    console.error('Failed to set Telegram Webhook:', err);
  }
}

// Helper to register global webhook on startup
export async function bootstrapWebhooks() {
  const globalBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!globalBotToken) {
    console.log("No global TELEGRAM_BOT_TOKEN found. Skipping global webhook bootstrap.");
    return;
  }

  console.log(`Bootstrapping global Telegram webhook...`);
  await setTelegramWebhook(globalBotToken);
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
      } else if (url.includes('reddit.com/r/')) {
        // Handle Reddit subreddit url
        const cleanUrl = url.split('?')[0].replace(/\/$/, "");
        rssUrl = `${cleanUrl}.json`;
      } else {
        const $ = await fetchPage(url);

        // Attempt 1: Modern YouTube HTML holds the externalId deep in script tags or meta tags
        let channelId = $('meta[itemprop="channelId"]').attr('content');

        if (!channelId) {
          // Attempt 2: Extract from the canonical link
          const canonicalLink = $('link[rel="canonical"]').attr('href');
          if (canonicalLink && canonicalLink.includes('/channel/')) {
            channelId = canonicalLink.split('/channel/')[1];
          }
        }

        if (!channelId) {
          // Attempt 3: Regex raw HTML for the common ytInitialData or externalId structure
          const htmlContent = $.html();
          const match = htmlContent.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/);
          if (match && match[1]) {
            channelId = match[1];
          }
        }

        if (channelId) {
          rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        } else {
          const rssLink = $('link[type="application/rss+xml"]').attr('href');
          if (rssLink) rssUrl = rssLink;
        }
      }

      if (!rssUrl) {
        return res.status(400).json({ error: 'Could not find RSS feed or Reddit JSON for this channel.' });
      }

      // 2. Verify RSS feed / Reddit JSON and get name
      if (rssUrl.includes('reddit.com')) {
        channelName = url.split('reddit.com/r/')[1]?.split('/')[0] || 'Reddit Channel';
        channelName = `r/${channelName}`;
      } else if (rssUrl.includes('youtube.com')) {
        let ytUrl = rssUrl;
        if (ytUrl.includes('/feeds/videos.xml?channel_id=')) {
          ytUrl = `https://www.youtube.com/channel/${ytUrl.split('channel_id=')[1]}`;
          rssUrl = ytUrl; // Update DB to store modern URL format
        }
        const $ = await fetchPage(ytUrl);
        channelName = $('meta[property="og:title"]').attr('content') || $('title').text().replace(' - YouTube', '') || 'Unknown Channel';
      } else {
        const feed = await parser.parseURL(rssUrl);
        channelName = feed.title || 'Unknown Channel';
      }

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

    let { data: settings, error } = await client.from('user_settings').select('*').eq('user_id', user.id).single();
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

    // Register webhook on save
    if (telegram_bot_token) {
      await setTelegramWebhook(telegram_bot_token);
    }

    res.json({ success: true });
  });

  // Save Summary
  app.post('/api/videos/:id/summary', async (req, res) => {
    const { id } = req.params;
    const { summary } = req.body;
    // We purposefully use the default admin 'supabase' client here
    // because saving the summary and triggering the notification needs to bypass RLS
    // to ensure it always succeeds, even if the user's session is wonky.

    if (!summary) return res.status(400).json({ error: 'Summary is required' });

    try {
      // 1. Update DB
      const { error: updateError } = await supabase.from('videos').update({ summary }).eq('id', id);
      if (updateError) throw updateError;

      // 2. Get Video Details for Notification
      const { data: video, error: fetchError } = await supabase.from('videos').select('*, channels(user_id)').eq('id', id).single();
      if (fetchError || !video) throw new Error('Video not found');

      // 3. Send Notification
      const { data: userSettings } = await supabase.from('user_settings').select('*').eq('user_id', video.channels.user_id).single();

      if (userSettings && userSettings.telegram_chat_id && !video.notified) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN || userSettings.telegram_bot_token;
        if (botToken) {
          await sendNotification(botToken, userSettings.telegram_chat_id, video.title, video.link, summary);
          await supabase.from('videos').update({ notified: true }).eq('id', id);
        }
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

      if (!userSettings || !userSettings.telegram_chat_id) {
        return res.status(400).json({ error: 'Telegram settings not configured' });
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN || userSettings.telegram_bot_token;
      if (!botToken) {
        return res.status(400).json({ error: 'System bot token not set' });
      }

      const result = await sendNotification(
        botToken,
        userSettings.telegram_chat_id,
        'Test Notification',
        'https://example.com',
        'This is a test message to verify your Telegram settings.',
        'Description'
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

  // Telegram Webhook
  app.post('/api/webhook/telegram', async (req, res) => {
    const { message } = req.body;
    if (!message || !message.text) {
      return res.sendStatus(200);
    }

    const chatId = message.chat.id.toString();
    const userText = message.text.trim();

    try {
      // Handle the Magic Link /start command
      if (userText.startsWith('/start ')) {
        const userId = userText.split(' ')[1];
        if (userId && userId.length > 10) {
          const { data: userSettings } = await supabase.from('user_settings').select('user_id, telegram_bot_token').eq('user_id', userId).single();
          if (userSettings) {
            await supabase.from('user_settings').update({ telegram_chat_id: chatId }).eq('user_id', userId);
            const botTokenToUse = process.env.TELEGRAM_BOT_TOKEN || userSettings.telegram_bot_token;
            await sendNotification(botTokenToUse || '', chatId, 'GlimpseAI Connected!', 'https://your-app.com', 'Your Telegram account is now successfully linked. You will receive video alerts here.');
          } else {
            const { error: insertError } = await supabase.from('user_settings').insert({ user_id: userId, telegram_chat_id: chatId });
            if (!insertError) {
              // Note: If they don't exist in user_settings at all, we don't have their custom bot token yet unless it's global
              await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, 'GlimpseAI Connected!', 'https://your-app.com', 'Your Telegram account is now successfully linked. You will receive video alerts here.');
            } else {
              await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, 'Connection Failed', '', 'Invalid connection code. Please try again from the app.');
            }
          }
        }
        return res.sendStatus(200);
      }

      // If it's a reply to an existing message (Q&A feature)
      if (message.reply_to_message && message.reply_to_message.text) {
        const parentText = message.reply_to_message.text;
        const linkMatch = parentText.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be|reddit\.com\/r\/)[^\s]+/);

        if (!linkMatch) {
          await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, 'Debugging', '', 'Error: No YouTube or Reddit link found in the parent message text.');
          return res.sendStatus(200);
        }

        const videoLink = linkMatch[0];

        // 2. Fetch user settings to get Gemini Key and Bot Token
        const { data: userSettingsList } = await supabase.from('user_settings').select('*').eq('telegram_chat_id', chatId).not('gemini_api_key', 'is', null).limit(1);
        const userSettings = userSettingsList && userSettingsList.length > 0 ? userSettingsList[0] : null;
        if (!userSettings || !userSettings.gemini_api_key) {
          await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, 'Debugging', '', 'Error: Missing Gemini API key in user settings.');
          return res.sendStatus(200);
        }

        // 3. Get Video Info & Transcript
        let { data: video } = await supabase.from('videos').select('*').eq('link', videoLink).single();

        if (!video) {
          const { data: fuzzyVideo } = await supabase.from('videos').select('*').ilike('link', `${videoLink}%`).single();
          if (fuzzyVideo) {
            video = fuzzyVideo;
          } else {
            await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, 'Debugging', '', `Error: Video not found in database for extracted link: ${videoLink}`);
            return res.sendStatus(200);
          }
        }

        let transcript = video.transcript || "";
        if (!transcript) {
          transcript = await getTranscript(video.link);
          if (transcript) {
            await supabase.from('videos').update({ transcript }).eq('id', video.id);
          }
        }

        // 4. Handle "Total" Command for Reddit bypass
        if (userText.trim().toLowerCase() === 'total') {
          await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, video.title || 'Full Post Content', video.link || '', 'Content\n\n' + (transcript || 'No content available.'));
          return res.sendStatus(200);
        }

        // 5. Ask Gemini
        try {
          const isReddit = video.link.includes('reddit.com');
          const ai = new GoogleGenAI({ apiKey: userSettings.gemini_api_key });
          const prompt = `
You are GlimpseAI, an expert technical assistant designed to analyze content. 
A user is interacting with you regarding the ${isReddit ? 'Reddit post' : 'video'} titled: "${video.title}".

INSTRUCTIONS:
1. Base your answer STRICTLY and EXCLUSIVELY on the provided content below. Do NOT use outside knowledge or hallucinate details.
2. If the user asks for a summary, deep dive, or general overview: Provide a concise, engaging summary focusing on what the viewer/reader will learn or experience.
3. If the user asks a specific question: Find the answer in the content. Be highly specific, info-dense, and provide exact facts or quotes.
4. If the content DOES NOT contain the answer to a specific question, you MUST reply exactly with: "The content does not mention this." Do not attempt to guess.

User Input: "${userText}"

--- CONTENT START ---
${transcript || video.summary || "No content available."}
--- CONTENT END ---
`;

          const aiResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
          });

          const answer = aiResponse.text || "I'm sorry, I couldn't process that question.";

          // 6. Reply to Telegram
          const msgType = isReddit ? 'Reddit Answer' : 'YouTube Answer';
          await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, video.title || 'Answer', video.link || '', msgType + '\n\n' + answer);
        } catch (genError: any) {
          console.error('Q&A AI Generation Error:', genError);
          const errMsg = typeof genError.message === 'string' ? genError.message : JSON.stringify(genError);
          let fallbackAnswer = "An unknown error occurred while generating the response.";

          if (errMsg.includes('429') || errMsg.includes('Quota exceeded') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            fallbackAnswer = "⚠️ <b>AI Limit Hit</b>\nYou have exceeded your free Gemini API quota. Please check your billing or wait before asking more questions.";
          }

          await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, video.title || 'Answer Error', video.link || '', 'Error\n\n' + fallbackAnswer);
        }

        return res.sendStatus(200);
      } else {
        return res.sendStatus(200);
      }
    } catch (error) {
      console.error('Telegram Webhook Error:', error);
      res.sendStatus(200); // Always return 200 to Telegram
    }
  });
}

async function backfillVideos(client: any, channelId: string, rssUrl: string) {
  try {
    let videos: any[] = [];

    if (rssUrl.includes('reddit.com')) {
      const response = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
      });
      const json = await response.json();

      if (json.data && json.data.children) {
        videos = json.data.children.map((child: any) => {
          const item = child.data;
          let thumb = item.thumbnail;
          if (!thumb || !thumb.startsWith('http')) {
            let preview = item.preview?.images?.[0]?.source?.url;
            if (preview) {
              thumb = preview.replace(/&amp;/g, '&');
            } else {
              thumb = '';
            }
          }
          return {
            channel_id: channelId,
            video_id: item.id || '',
            title: item.title,
            link: `https://www.reddit.com${item.permalink}`,
            published_at: new Date(item.created_utc * 1000).toISOString(),
            transcript: item.selftext || item.title || '',
            notified: true,
            thumbnail_url: thumb
          };
        }).filter((v: any) => v.video_id);
      }
    } else if (rssUrl.includes('youtube.com')) {
      let ytUrl = rssUrl;
      if (ytUrl.includes('/feeds/videos.xml?channel_id=')) {
        ytUrl = `https://www.youtube.com/channel/${ytUrl.split('channel_id=')[1]}`;
      }

      try {
        const response = await fetch(ytUrl);
        const text = await response.text();
        const match = text.match(/var ytInitialData = ({.*?});<\/script>/);
        if (match) {
          const data = JSON.parse(match[1]);
          let videoItems: any[] = [];
          JSON.stringify(data, (key, value) => {
            if (key === 'gridVideoRenderer' || key === 'videoRenderer' || key === 'richItemRenderer') {
              if (value?.content?.videoRenderer) {
                videoItems.push(value.content.videoRenderer);
              } else if (value?.videoId) {
                videoItems.push(value);
              }
            }
            return value;
          });

          const seenIds = new Set();
          const recentItems = videoItems.filter(v => {
            if (!v.videoId || seenIds.has(v.videoId)) return false;
            seenIds.add(v.videoId);
            return true;
          }).slice(0, 5);

          videos = await Promise.all(recentItems.map(async (v) => {
            const videoId = v.videoId;
            const link = `https://www.youtube.com/watch?v=${videoId}`;
            let transcriptStr = '';
            try {
              transcriptStr = await getTranscript(link);
            } catch (e) { }

            return {
              channel_id: channelId,
              video_id: videoId || '',
              title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown Video',
              link: link,
              published_at: new Date().toISOString(),
              transcript: transcriptStr,
              notified: true,
              thumbnail_url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
            };
          }));
          videos = videos.filter(v => v.video_id);
        }
      } catch (ytErr) {
        console.error('YouTube scraper failed for', ytUrl, ytErr);
      }
    } else {
      const feed = await parser.parseURL(rssUrl);
      if (feed.items) {
        // We only backfill 5 to avoid rate-limiting the transcript API or slowing down insertion too much
        const recentItems = feed.items.slice(0, 5) as any[];
        videos = await Promise.all(recentItems.map(async (item) => {
          const videoId = item.id.split(':').pop();

          let transcriptStr = '';
          try {
            transcriptStr = await getTranscript(item.link || '');
          } catch (e) { } // Ignore if disabled

          return {
            channel_id: channelId,
            video_id: videoId || '',
            title: item.title,
            link: item.link,
            published_at: item.isoDate || new Date().toISOString(),
            transcript: transcriptStr,
            notified: true,
            thumbnail_url: ''
          };
        }));

        videos = videos.filter(v => v.video_id);
      }
    }

    // Upsert to handle ON CONFLICT DO NOTHING natively in Supabase via unique constraint
    if (videos.length > 0) {
      const { error } = await client.from('videos').upsert(videos, { onConflict: 'channel_id,video_id', ignoreDuplicates: true });
      if (error) console.error("Database upsert error backfilling items:", error);
    }
    console.log(`Backfilled ${videos.length} items for channel ${channelId}`);
  } catch (error) {
    console.error(`Error backfilling items for channel ${channelId}:`, error);
  }
}