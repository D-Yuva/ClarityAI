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

          let summary = "Summary unavailable.";
          let notified = false;

          const userKey = settingsByUserId[channel.user_id]?.gemini_api_key;
          if (userKey) {
            try {
              const ai = new GoogleGenAI({ apiKey: userKey });
              const prompt = `
                Analyze the following YouTube video and provide a concise, engaging summary (under 50 words).
                Focus on what the viewer will learn or experience.
                Title: ${item.title}
                Link: ${item.link}
              `;

              const response = await ai.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
              });

              summary = response.text || "Could not generate summary.";

              const botToken = settingsByUserId[channel.user_id]?.telegram_bot_token;
              const chatId = settingsByUserId[channel.user_id]?.telegram_chat_id;

              if (botToken && chatId) {
                await sendNotification(botToken, chatId, item.title || '', item.link || '', summary);
                notified = true;
              }
            } catch (err: any) {
              console.error("Background AI Summary failed:", err);
              summary = `AI Error: ${err.message || 'An unknown error occurred.'}`;
            }
          } else {
            summary = "Summary pending generation... (Action Required: Add Gemini API Key via Web Dashboard)";
          }

          const { error: insertError } = await supabase.from('videos').insert({
            channel_id: channel.id,
            video_id: videoId,
            title: item.title,
            link: item.link,
            published_at: item.isoDate,
            summary: summary,
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
  cron.schedule('*/45 * * * *', () => {
    checkFeeds();
  });

  setTimeout(checkFeeds, 5000);
}
