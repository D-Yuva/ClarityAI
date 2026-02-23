import express from "express";
import { setupRoutes } from "../server/routes";
import { checkFeeds } from "../server/scheduler";

const app = express();
app.use(express.json());

// Setup standard API routes
setupRoutes(app);

// Dedicated Cron endpoint
app.get("/api/cron", async (req, res) => {
    // Simple auth check for Vercel Cron (optional but recommended)
    // if (req.headers['x-vercel-cron'] !== 'true') return res.status(401).end();

    try {
        console.log("Cron job triggered via Vercel...");
        await checkFeeds();
        res.json({ success: true, message: "Feeds checked successfully" });
    } catch (error: any) {
        console.error("Cron job failed:", error);
        res.status(500).json({ error: error.message });
    }
});

export default app;
