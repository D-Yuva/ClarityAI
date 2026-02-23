import cron from 'node-cron';
import Parser from 'rss-parser';
import { supabase } from './db';
import { GoogleGenAI } from "@google/genai";
import { sendNotification } from './notifications';

const parser = new Parser();

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
      const feed = await parser.parseURL(channel.rss_url);

      await supabase.from('channels').update({ last_checked: new Date().toISOString() }).eq('id', channel.id);

      for (const item of feed.items) {
        const videoId = item.id;

        const { data: existing } = await supabase.from('videos').select('id').eq('channel_id', channel.id).eq('video_id', videoId).single();

        if (!existing) {
          console.log(`New video found for channel ${channel.name}: ${item.title}`);

          let videoType: 'short' | 'longform' = 'longform';
          if ((item.title || '').includes('#shorts') || (item.contentSnippet || '').toLowerCase().includes('short')) {
            videoType = 'short';
          }

          // The user only wants Telegram notifications when a summary is manually generated.
          // Therefore, we only insert the video silently into the database here.

          const { error: insertError } = await supabase.from('videos').insert({
            channel_id: channel.id,
            video_id: videoId,
            title: item.title,
            link: item.link,
            published_at: item.isoDate,
            summary: "",
            video_type: videoType,
            notified: false
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
  cron.schedule('*/45 * * * *', () => {
    checkFeeds();
  });

  setTimeout(checkFeeds, 5000);
}
