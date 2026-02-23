<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bc4447ba-a9da-4a6e-bf85-6a7f14a08e1a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to Vercel

1.  Install the [Vercel CLI](https://vercel.com/docs/cli).
2.  Run `vercel` in the project root.
3.  Add the following Environment Variables in the Vercel Dashboard:
    - `GEMINI_API_KEY`
    - `VITE_SUPABASE_URL`
    - `VITE_SUPABASE_ANON_KEY`
    - `SUPABASE_SERVICE_ROLE_KEY` (Required for Cron jobs to work offline)
4.  Vercel will automatically handle the build and deployment.

> [!TIP]
> After deploying, you can make changes and push them to your linked GitHub repository. Vercel will automatically trigger a new deployment for every push!
