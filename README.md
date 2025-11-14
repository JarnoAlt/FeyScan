# Fey Token Launchpad Monitor

Live monitoring dashboard for token deployments on the Fey launchpad (Base Network).

## Features

- Real-time token deployment tracking
- Holder count monitoring with live updates
- Dev buy alerts (notifications for high dev buys > 0.25 ETH)
- Priority-based holder checking (focuses on high-volume tokens)
- Multi-provider RPC support (Alchemy + Infura for parallel operations)
- Supabase integration for persistent storage
- Black & green Fey-themed UI

## Tech Stack

- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL)
- **Blockchain**: ethers.js (Base Network)
- **RPC Providers**: Alchemy, Infura

## Environment Variables

### Backend (set in Vercel dashboard or `.env` for local dev)

```
ALCHEMY_API_KEY=your_alchemy_key
INFURA_API_KEY=your_infura_key
ETHERSCAN_API_KEY=your_etherscan_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=3001
```

### Frontend (set in Vercel dashboard or `.env.local`)

```
VITE_API_URL=http://localhost:3001  # Only needed for local dev
```

## Local Development

### Backend
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Vercel Deployment

### Important: Backend Monitoring Limitation

**Vercel is serverless** - it doesn't support long-running processes. The continuous monitoring loop in `monitor.js` won't work on Vercel.

**Recommended Solution**: Deploy the backend separately:
- **Railway** (recommended): Easy deployment, supports long-running processes
- **Render**: Free tier available, supports web services
- **Fly.io**: Good for Node.js apps
- **DigitalOcean App Platform**: Simple deployment

Keep the frontend on Vercel, deploy backend elsewhere, and update `frontend/src/App.jsx` API URL.

### If Deploying Full Stack to Vercel

1. **Set Environment Variables** in Vercel dashboard:
   - Go to your project settings → Environment Variables
   - Add all backend environment variables:
     - `ALCHEMY_API_KEY`
     - `INFURA_API_KEY`
     - `ETHERSCAN_API_KEY`
     - `SUPABASE_URL`
     - `SUPABASE_ANON_KEY`
   - Frontend variables are optional (only needed if using custom API URL)

2. **Deploy**:
   - Connect your GitHub repo to Vercel
   - Vercel will auto-detect and deploy using `vercel.json`

3. **Convert Monitoring to Cron Jobs** (if keeping backend on Vercel):
   - Remove `startMonitoring()` from `server.js`
   - Create Vercel Cron Jobs that call `/api/backfill` periodically
   - This won't be real-time but will check periodically

## Database Setup

Run the SQL migrations in `backend/supabase-setup.sql` and `backend/MIGRATION_002_add_last_holder_check.sql` in your Supabase SQL editor.

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── monitor.js       # Blockchain monitoring logic
│   │   ├── server.js        # Express API server
│   │   ├── supabase-storage.js  # Supabase database layer
│   │   └── storage.js       # JSON fallback storage
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Main app component
│   │   └── components/
│   │       └── TokenFeed.jsx  # Deployment feed component
│   └── package.json
└── vercel.json              # Vercel configuration
```
