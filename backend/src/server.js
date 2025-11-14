import cors from 'cors';
import express from 'express';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { startMonitoring } from './monitor.js';
import { getAllDeployments, getLatestDeployment } from './supabase-storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true, // Allow all origins (for ngrok)
  credentials: true
}));
app.use(express.json());

// API Routes
app.get('/api/deployments', async (req, res) => {
  try {
    const deployments = await getAllDeployments();
    res.json({ deployments });
  } catch (error) {
    console.error('Error fetching deployments:', error);
    res.status(500).json({ error: 'Failed to fetch deployments' });
  }
});

app.get('/api/latest', async (req, res) => {
  try {
    const latest = await getLatestDeployment();
    if (latest) {
      res.json({ deployment: latest });
    } else {
      res.json({ deployment: null });
    }
  } catch (error) {
    console.error('Error fetching latest deployment:', error);
    res.status(500).json({ error: 'Failed to fetch latest deployment' });
  }
});

// Farcaster Manifest Route - serve at /api/farcaster-manifest for Vercel
app.get('/api/farcaster-manifest', (req, res) => {
  // Define manifest directly in code (like badtraders) - don't read from file system
  const manifest = {
    accountAssociation: {
      header: "eyJmaWQiOjQ3NDg2NywidHlwZSI6ImN1c3RvZHkiLCJrZXkiOiIweGQ1OUIyOUNEZGM4NGZjNTNDNzM3NjIzOEUzRjE2QUMzMTI1MTZDNTYifQ",
      payload: "eyJkb21haW4iOiJmZXlzY2FuLnh5eiJ9",
      signature: "XguSJ9ttZaIUzF7rpo9Nbnj2NkYqHdSFDkdKV+CZGPp0fjy9v8NJYLUqLOugu0hJxev8CSawC059aR3/xDG1DRs="
    },
    miniapp: {
      version: "1",
      name: "FeyScan",
      subtitle: "Token Launchpad Monitor",
      description: "Live monitoring dashboard for token deployments on the Fey launchpad. Track new token launches, dev buys, holder counts, and more on Base Network.",
      tagline: "Monitor Fey token deployments in real-time",
      iconUrl: "https://feyscan.xyz/FeyScanner.jpg",
      homeUrl: "https://feyscan.xyz",
      imageUrl: "https://feyscan.xyz/FeyScanner.jpg",
      heroImageUrl: "https://feyscan.xyz/FeyScanner.jpg",
      buttonTitle: "Open FeyScan",
      splashImageUrl: "https://feyscan.xyz/FeyScanner.jpg",
      splashBackgroundColor: "#000000",
      primaryCategory: "defi",
      tags: ["defi", "tokens", "base", "monitoring", "launchpad"],
      screenshotUrls: ["https://feyscan.xyz/FeyScanner.jpg"],
      castShareUrl: "https://feyscan.xyz",
      ogTitle: "FeyScan - Token Launchpad Monitor",
      ogDescription: "Live monitoring dashboard for token deployments on the Fey launchpad on Base Network.",
      ogImageUrl: "https://feyscan.xyz/FeyScanner.jpg",
      webhookUrl: "https://feyscan.xyz/api/webhook"
    }
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(manifest);
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const deployments = await getAllDeployments();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      deploymentsCount: deployments.length,
      uptime: process.uptime()
    });
  } catch (error) {
    res.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Manual backfill endpoint
app.post('/api/backfill', async (req, res) => {
  try {
    const { fromBlock, toBlock } = req.body;
    if (!fromBlock || !toBlock) {
      return res.status(400).json({ error: 'fromBlock and toBlock required' });
    }

    const { backfillHistory } = await import('./monitor.js');
    await backfillHistory(parseInt(fromBlock), parseInt(toBlock));
    const deployments = await getAllDeployments();
    res.json({ success: true, message: 'Backfill completed', count: deployments.length });
  } catch (error) {
    console.error('Error in backfill endpoint:', error);
    res.status(500).json({ error: 'Backfill failed', message: error.message });
  }
});

// Export app for Vercel serverless
export default app;

// Only start server and monitoring when running locally (not in Vercel)
if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API available at http://localhost:${PORT}/api`);

    // Start monitoring only in local/dev environment
    startMonitoring();
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
} else {
  console.log('Running in Vercel serverless environment - monitoring disabled');
}

