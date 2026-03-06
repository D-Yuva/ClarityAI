# Telegram Video Reply Issue Analysis

## The Problem
There are two distinct issues occurring when you reply to a video notification on Telegram to ask the AI a question:

### 1. Telegram Markdown Parsing Error (The Primary Issue)
When Gemini generates an answer, it natively uses Markdown formatting (e.g., `**bold text**`, `## headers`, bullet points). Telegram has historically supported a legacy `Markdown` parser that only accepts single asterisks for bold (`*bold text*`) and rejects double asterisks or other advanced markdown features. 

In `server/notifications.ts`, notifications are sent with `parse_mode: 'Markdown'`. When the Gemini AI response containing `**` or other raw markdown is passed to Telegram, **Telegram's API throws a `400 Bad Request: can't parse entities` error**, and the message silently fails to send. That's why you don't see any reply.

### 2. Custom Telegram Bot Token Omission
In `server/routes.ts`, when processing the Telegram Webhook for a reply, the code successfully fetches the `userSettings` to get the `gemini_api_key`. However, when attempting to send the message back to you:
```typescript
await sendNotification(process.env.TELEGRAM_BOT_TOKEN || '', chatId, ...)
```
It exclusively looks for the global `TELEGRAM_BOT_TOKEN` in the `.env` file and forgets to check `userSettings.telegram_bot_token`. If your setup relies on a personal/custom bot token stored in the database, the server will try to authenticate with an empty string and fail immediately.

## Proposed Changes

To fix this, we need to modify **`server/routes.ts`** and **`server/notifications.ts`**.

### Change 1: Pass the correct Bot Token
In the Telegram webhook handler inside `server/routes.ts`, extract the user's bot token and ensure the fallback logic operates correctly for every AI reply message. 

```typescript
const botTokenToUse = process.env.TELEGRAM_BOT_TOKEN || (userSettings ? userSettings.telegram_bot_token : '');
```
We must update all four `sendNotification` invocations within the webhook Q&A logic to use `botTokenToUse`.

### Change 2: Scrub Gemini Markdown for Telegram
We must clean the AI's response before sending it to Telegram. We can use a simple regex replacing function to convert Gemini's `**bold**` to Telegram's legacy `*bold*` and escape/remove incompatible characters (like `#` block headers).

```typescript
// Example formatting cleanup
let cleanAnswer = answer
  .replace(/\*\*(.*?)\*\*/g, '*$1*') // Convert **bold** to *bold* safely
  .replace(/#/g, '')                 // Remove unsupported header hashtags
  .replace(/_([^_]+)_/g, '$1');      // Strip underscores to prevent unescaped entity errors in legacy markdown
```

This will gracefully prevent Telegram from violently rejecting the AI's response format!
