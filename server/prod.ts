/**
 * Production server: serves the Vite-built static files AND the Express API
 * over HTTPS on a single port (default 8443).
 */
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import dotenv from 'dotenv';
import { registerRoutes } from './routes.js';

// ── env ──────────────────────────────────────────────────────────────────────
dotenv.config({ path: '.env.local' });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8443;

// ── Express app ──────────────────────────────────────────────────────────────
const app = express();

registerRoutes(app);

// --- Static files (Vite build output) ---
app.use(express.static(path.join(ROOT, 'dist')));

// SPA fallback: serve index.html for any non-API route
app.get('*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'dist', 'index.html'));
});

// ── HTTP server ──────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`🛫 BumpHunter PRODUCTION running on http://0.0.0.0:${PORT}`);
  console.log(`   Access via: http://pql.flicker-ulmer.ts.net:${PORT}`);
  console.log('   Serving: Vite build (dist/) + Express API (/api/*)');
});
