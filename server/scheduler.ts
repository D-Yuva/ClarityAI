import cron from 'node-cron';
import Parser from 'rss-parser';
import { supabase } from './db';
import { GoogleGenAI } from "@google/genai";
import { sendNotification } from './notifications';
import { getTranscript } from './transcriber';

const parser = new Parser({
  customFields: {
    item: [
      ['media:group', 'mediaGroup']
    ]
  }
});

export async function checkFeeds() {
  console.log('Checking feeds (Scheduler)...');

  const { data: channels, error } = await supabase.from('channels').select('*');

  if (error) {
    console.error("Failed to fetch channels in scheduler:", error);
    return;
  }

  // Fetch all user settings
  const { data: allSettings } = await supabase.from('user_settings').select('*');
  const settingsByUserId = (allSettings || []).reduce((acc: any, curr: any) => {
    acc[curr.user_id] = curr;
    return acc;
  }, {});

  for (const channel of channels || []) {
    try {
      let feedItems: any[] = [];

      if (channel.rss_url && channel.rss_url.includes('reddit.com')) {
        // Use sort=new to always get the latest posts, not "hot" (older viral posts)
        const redditNewUrl = channel.rss_url.includes('?')
          ? `${channel.rss_url}&sort=new&limit=50`
          : `${channel.rss_url}?sort=new&limit=50`;
        const response = await fetch(redditNewUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
        });
        const json = await response.json();
        if (json.data && json.data.children) {
          feedItems = json.data.children.map((child: any) => {
            const it = child.data;
            // Prefer high-res preview image over the low-res thumbnail
            let thumb = it.preview?.images?.[0]?.source?.url || '';
            if (thumb) {
              thumb = thumb.replace(/&amp;/g, '&');
            } else if (it.thumbnail && it.thumbnail.startsWith('http')) {
              thumb = it.thumbnail;
            }

            return {
              id: it.id,
              title: it.title,
              link: `https://www.reddit.com${it.permalink}`,
              isoDate: new Date(it.created_utc * 1000).toISOString(),
              contentSnippet: it.selftext,
              content: it.selftext,
              thumbnail_url: thumb
            };
          });
        }
      } else if (channel.rss_url && channel.rss_url.includes('youtube.com')) {
        // Use the YouTube RSS XML feed directly — reliable, always up-to-date
        // rss_url is stored as https://www.youtube.com/feeds/videos.xml?channel_id=XXX
        try {
          const feed = await parser.parseURL(channel.rss_url);
          feedItems = (feed.items || []).map((item: any) => {
            // YouTube RSS item id format: "yt:video:VIDEO_ID"
            const videoId = (item.id || '').split(':').pop() || '';
            return {
              id: videoId,
              title: item.title || '',
              link: item.link || `https://www.youtube.com/watch?v=${videoId}`,
              isoDate: item.isoDate || new Date().toISOString(),
              contentSnippet: item.contentSnippet || '',
              thumbnail_url: videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : ''
            };
          });
        } catch (ytErr) {
          console.error('YouTube RSS parse failed for', channel.rss_url, ytErr);
        }
      } else {
        const feed = await parser.parseURL(channel.rss_url);
        feedItems = feed.items;
      }

      await supabase.from('channels').update({ last_checked: new Date().toISOString() }).eq('id', channel.id);

      for (const item of feedItems) {
        const videoId = item.id;

        const { data: existing } = await supabase.from('videos').select('id').eq('channel_id', channel.id).eq('video_id', videoId).single();

        if (!existing) {
          console.log(`New video found for channel ${channel.name}: ${item.title}`);

          let videoType: 'short' | 'longform' = 'longform';
          if ((item.title || '').includes('#shorts') || (item.contentSnippet || '').toLowerCase().includes('short')) {
            videoType = 'short';
          }

          let summary = "";
          let transcript = "";
          let notified = false;

          // Fetch transcript before AI generation
          if (item.link && item.link.includes('reddit.com')) {
            // For Reddit, the full post body is usually in item.content as HTML
            const rawContent = item.content || item.contentSnippet || '';
            transcript = rawContent.replace(/<[^>]*>?/gm, '').trim();
          } else {
            transcript = await getTranscript(item.link || '');
          }

          const botToken = process.env.TELEGRAM_BOT_TOKEN || settingsByUserId[channel.user_id]?.telegram_bot_token;
          const chatId = settingsByUserId[channel.user_id]?.telegram_chat_id;

          if (botToken && chatId) {
            const contextType = channel.rss_url && channel.rss_url.includes('reddit.com') ? 'Reddit Post' : 'YouTube Video';
            await sendNotification(botToken, chatId, item.title || '', item.link || '', contextType);
            notified = true;
          }

          const { error: insertError } = await supabase.from('videos').insert({
            channel_id: channel.id,
            video_id: videoId,
            title: item.title,
            link: item.link,
            published_at: item.isoDate,
            summary: summary,
            transcript: transcript, // Cache transcript for Q&A
            video_type: videoType,
            notified: notified,
            thumbnail_url: item.thumbnail_url || ''
          });

          if (insertError) console.error("Error inserting video:", insertError);
        }
      }
    } catch (err) {
      console.error(`Error checking feed for ${channel.name}:`, err);
    }
  }
}

export function startScheduler() {
  cron.schedule('*/30 * * * *', () => {
    checkFeeds();
  });

  setTimeout(checkFeeds, 5000);
}
