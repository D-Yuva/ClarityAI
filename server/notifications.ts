export async function sendNotification(botToken: string, chatId: string, title: string, link: string, summary: string) {
  // Escape Markdown characters in summary to prevent errors
  const safeSummary = summary ? summary.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&') : '';
  const message = summary
    ? `*New Video Alert!* 📺\n\n*${title}*\n\n${safeSummary}\n\n${link}`
    : `*New Video Alert!* 📺\n\n*${title}*\n\n${link}`;

  // Priority 1: Telegram (Official, Free, Safe)
  if (botToken && chatId) {
    try {
      console.log('Sending via Telegram...');
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
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
