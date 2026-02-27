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
        const response = await fetch(channel.rss_url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Node.js)' }
        });
        const json = await response.json();
        if (json.data && json.data.children) {
          feedItems = json.data.children.map((child: any) => {
            const it = child.data;
            return {
              id: it.id,
              title: it.title,
              link: `https://www.reddit.com${it.permalink}`,
              isoDate: new Date(it.created_utc * 1000).toISOString(),
              contentSnippet: it.selftext,
              content: it.selftext
            };
          });
        }
      } else if (channel.rss_url && channel.rss_url.includes('youtube.com')) {
        let ytUrl = channel.rss_url;
        // Convert old RSS urls to standard channel urls so we can scrape the HTML
        if (ytUrl.includes('/feeds/videos.xml?channel_id=')) {
          ytUrl = `https://www.youtube.com/channel/${ytUrl.split('channel_id=')[1]}`;
        }

        try {
          const response = await fetch(ytUrl);
          const text = await response.text();
          const match = text.match(/var ytInitialData = ({.*?});<\/script>/);
          if (match) {
            const data = JSON.parse(match[1]);
            let videos: any[] = [];
            JSON.stringify(data, (key, value) => {
              if (key === 'gridVideoRenderer' || key === 'videoRenderer' || key === 'richItemRenderer') {
                if (value?.content?.videoRenderer) {
                  videos.push(value.content.videoRenderer);
                } else if (value?.videoId) {
                  videos.push(value);
                }
              }
              return value;
            });

            // Deduplicate by videoId and convert to standardized item structure
            const seenIds = new Set();
            feedItems = videos.filter(v => {
              if (!v.videoId || seenIds.has(v.videoId)) return false;
              seenIds.add(v.videoId);
              return true;
            }).slice(0, 15).map((v: any) => ({
              id: v.videoId,
              title: v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown Video',
              link: `https://www.youtube.com/watch?v=${v.videoId}`,
              isoDate: new Date().toISOString(),
              contentSnippet: v.descriptionSnippet?.runs?.[0]?.text || ''
            }));
          }
        } catch (ytErr) {
          console.error('YouTube scraper failed for', ytUrl, ytErr);
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
            notified: notified
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
