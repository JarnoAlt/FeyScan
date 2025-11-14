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

