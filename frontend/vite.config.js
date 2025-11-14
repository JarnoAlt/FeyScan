import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    port: 3000,
    host: true, // Allow external connections
    allowedHosts: [
      '.ngrok.io',
      '.ngrok-free.app',
      '.ngrok.app',
      'localhost'
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  }
});

