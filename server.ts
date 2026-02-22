import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import { setupRoutes } from "./server/routes";
import { startScheduler } from "./server/scheduler";
import { initDb } from "./server/db";

async function startServer() {
  try {
    const app = express();
    const PORT = 3000;

    // Middleware to parse JSON bodies
    app.use(express.json());

    // Initialize Database
    try {
      initDb();
      console.log("Database initialized successfully.");
    } catch (err) {
      console.error("FATAL: Failed to initialize database. Server is stopping.", err);
      process.exit(1);
    }

    // Setup API Routes
    setupRoutes(app);

    // API 404 Handler - Prevent fallthrough to Vite
    app.use('/api/*', (req, res) => {
      res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
    });

    // Start Background Scheduler
    try {
      startScheduler();
    } catch (err) {
      console.error("Failed to start scheduler:", err);
    }

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      // Production static file serving (placeholder for now)
      app.use(express.static('dist'));
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Fatal server error:", error);
    process.exit(1);
  }
}

startServer();
