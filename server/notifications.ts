export async function sendNotification(botToken: string, chatId: string, title: string, link: string, summary: string) {
  // Simple HTML escaping to avoid tag injection
  const escapeHTML = (str: string) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const safeTitle = escapeHTML(title || '');
  const safeSummary = escapeHTML(summary || '');
  const message = summary
    ? `📺 <b>New Video Alert!</b>\n\n📌 <b>Title:</b> ${safeTitle}\n\n📝 <b>Summary:</b>\n${safeSummary}\n\n🔗 <b>Link:</b> ${link}`
    : `📺 <b>New Video Alert!</b>\n\n📌 <b>Title:</b> ${safeTitle}\n\n🔗 <b>Link:</b> ${link}`;

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
          parse_mode: 'HTML'
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
