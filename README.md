# Fey Token Launchpad Monitor

Live monitoring system for the Fey.money token launchpad contract on Base Network. Monitors for new "Deploy Token" method calls every 15 seconds and displays them on a fast, live website.

## Contract Address

`0x8EEF0dC80ADf57908bB1be0236c2a72a7e379C2d`

## Tech Stack

- **Backend**: Node.js + Express + ethers.js
- **Frontend**: React + Vite
- **Storage**: JSON file
- **Dev Tools**: nodemon (backend), Vite HMR (frontend)

## Setup

### Prerequisites

- Node.js (v18 or higher)
- npm
- Alchemy API key (optional but recommended for better performance)

### Installation

1. Set up environment variables:
   - Create a `.env` file in the `backend` directory
   - Add your Alchemy API key: `ALCHEMY_API_KEY=your_key_here`
   - If no Alchemy key is provided, the system will use the public Base Network RPC (rate-limited)

2. Install backend dependencies:
```powershell
cd backend
npm install
```

2. Install frontend dependencies:
```powershell
cd frontend
npm install
```

## Development

### Start Backend (with nodemon hot reload)

From the `backend` directory:
```powershell
npm run dev
```

The backend will:
- Start on port 3001
- Automatically restart on file changes (nodemon)
- Begin monitoring the contract every 15 seconds

### Start Frontend (with Vite HMR)

From the `frontend` directory:
```powershell
npm run dev
```

The frontend will:
- Start on port 3000
- Hot reload on file changes (Vite HMR)
- Poll the backend API every 15 seconds for new deployments

## API Endpoints

- `GET /api/deployments` - Get all stored deployments
- `GET /api/latest` - Get the most recent deployment
- `GET /api/health` - Health check

## Data Storage

Deployments are stored in `data/deployments.json`. The system:
- Prevents duplicates (by transaction hash)
- Keeps the most recent 1000 deployments
- Stores token name, address, transaction details, and external links

## Features

- Real-time monitoring of token deployments
- Automatic token name detection
- Quick links to DexScreener, Defined.fi, and BaseScan
- Modern, responsive UI
- Fast development workflow with hot reload

