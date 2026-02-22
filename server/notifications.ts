import { db } from './db';

export async function sendNotification(title: string, link: string, summary: string) {
  const settings = db.prepare('SELECT * FROM settings').all() as any[];
  const config = settings.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});

  // Escape Markdown characters in summary to prevent errors
  const safeSummary = summary.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  const message = `*New Video Alert!* 📺\n\n*${title}*\n\n${safeSummary}\n\n${link}`;

  // Priority 1: Telegram (Official, Free, Safe)
  if (config.telegram_bot_token && config.telegram_chat_id) {
    try {
      console.log('Sending via Telegram...');
      const url = `https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegram_chat_id,
          text: message,
          parse_mode: 'Markdown'
        })
      });

      if (res.ok) {
        console.log('Telegram notification sent!');
        return { success: true };
      } else {
        const errorText = await res.text();
        console.error('Telegram failed:', errorText);
        return { success: false, error: errorText };
      }
    } catch (err: any) {
      console.error('Failed to send Telegram notification:', err);
      return { success: false, error: err.message };
    }
  } else {
    console.log('No notification settings configured (Telegram). Skipping.');
    return { success: false, error: 'No Telegram settings configured' };
  }
}
