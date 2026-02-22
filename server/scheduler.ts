import cron from 'node-cron';
import Parser from 'rss-parser';
import { db } from './db';
import { GoogleGenAI } from "@google/genai";
import { sendNotification } from './notifications';

const parser = new Parser();

let ai: GoogleGenAI | null = null;

function getAiClient() {
  // Lazy initialization of the AI client
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      console.warn("GEMINI_API_KEY is not set or is a placeholder. AI summaries will be disabled.");
      return null;
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
}

export async function checkFeeds() {
  console.log('Checking feeds...');
  const channels = db.prepare('SELECT * FROM channels').all();

  for (const channel of channels as any[]) {
    try {
      const feed = await parser.parseURL(channel.rss_url);
      
      // Update last_checked
      db.prepare('UPDATE channels SET last_checked = CURRENT_TIMESTAMP WHERE id = ?').run(channel.id);

      // Check for new videos
      for (const item of feed.items) {
        const videoId = item.id; // usually "yt:video:VIDEO_ID"
        const existing = db.prepare('SELECT id FROM videos WHERE video_id = ?').get(videoId);

        if (!existing) {
          console.log(`New video found: ${item.title}`);
          
          // Step 1: Deterministic Classification
          const title = item.title || '';
          const description = item.contentSnippet || item.content || '';
          let videoType: 'short' | 'longform' = 'longform';
          if (title.includes('#shorts') || description.toLowerCase().includes('short')) {
            videoType = 'short';
          }

          // Step 2: Generate Summary
          let summary = "Summary unavailable.";
          const aiClient = getAiClient();
          if (aiClient) {
            try {
              const prompt = `
                Analyze the following YouTube video and provide a concise, engaging summary (under 50 words).
                Focus on what the viewer will learn or experience.
                Title: ${title}
                Description: ${description}
              `;
              
              const response = await aiClient.models.generateContent({
                model: "gemini-3-flash-preview",
                contents: prompt,
              });
              
              summary = response.text || "Could not generate summary.";

            } catch (err: any) {
              console.error("AI Summary failed. Full error:", JSON.stringify(err, null, 2));
              // Display the actual error in the summary for easier debugging
              summary = `AI Error: ${err.message || 'An unknown error occurred.'}`;
            }
          }

          // Save to DB
          const stmt = db.prepare(`
            INSERT INTO videos (channel_id, video_id, title, link, published_at, summary, video_type, notified)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
          `);
          stmt.run(channel.id, videoId, item.title, item.link, item.isoDate, summary, videoType);


        }
      }
    } catch (err) {
      console.error(`Error checking feed for ${channel.name}:`, err);
    }
  }

  // After checking all feeds, send notifications for any new videos found
  // DISABLED: Client-side summary generation now triggers notifications
  // await sendPendingNotifications();
}

export function startScheduler() {
  // Run every 45 minutes
  cron.schedule('*/45 * * * *', () => {
    checkFeeds();
  });
  
  // Also run immediately on startup after a short delay
  setTimeout(checkFeeds, 5000);
}

async function sendPendingNotifications() {
  const videosToNotify = db.prepare(`
    SELECT v.*, c.name as channel_name 
    FROM videos v
    JOIN channels c ON v.channel_id = c.id
    WHERE v.notified = 0
  `).all();

  if (videosToNotify.length > 0) {
    console.log(`Sending ${videosToNotify.length} new notifications...`);
    for (const video of videosToNotify as any[]) {
      try {
        await sendNotification(video.title, video.link, video.summary);
        db.prepare('UPDATE videos SET notified = 1 WHERE id = ?').run(video.id);
        console.log(`Notification sent for: ${video.title}`);
      } catch (error) {
        console.error(`Failed to send notification for video ${video.id}:`, error);
      }
    }
  }
}
