import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

const TEST_PORT = 3099;
const BASE = `http://localhost:${TEST_PORT}`;

let server: ChildProcess;

async function waitForServer(port: number, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

beforeAll(async () => {
  server = spawn(
    path.resolve('node_modules/.bin/tsx'),
    ['server/index.ts'],
    {
      env: { ...process.env, API_PORT: String(TEST_PORT) },
      stdio: 'pipe',
      cwd: process.cwd(),
    },
  );
  // Capture stderr for debugging
  let stderr = '';
  server.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  server.on('error', (e) => { console.error('Server spawn error:', e); });
  await waitForServer(TEST_PORT);
}, 20000);

afterAll(() => {
  server?.kill('SIGTERM');
});

describe('API Endpoints', () => {
  it('GET /api/health returns 200 with status ok', async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('GET /api/flights/search requires origin, dest, date params', async () => {
    // Missing all params
    const res1 = await fetch(`${BASE}/api/flights/search`);
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error).toContain('required');

    // Missing dest and date
    const res2 = await fetch(`${BASE}/api/flights/search?origin=ATL`);
    expect(res2.status).toBe(400);

    // Missing date only
    const res3 = await fetch(`${BASE}/api/flights/search?origin=ATL&dest=LGA`);
    expect(res3.status).toBe(400);

    // All params provided should succeed
    const res4 = await fetch(`${BASE}/api/flights/search?origin=ATL&dest=LGA&date=2026-04-14`);
    expect(res4.status).toBe(200);
  });

  it('GET /api/flights/heatmap returns day entries', async () => {
    const res = await fetch(`${BASE}/api/flights/heatmap?origin=ATL&dest=LGA&weeks=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(14);
    expect(body[0]).toHaveProperty('date');
    expect(body[0]).toHaveProperty('predictedScore');
  });

  it('GET /api/stats/carriers returns array of carriers', async () => {
    const res = await fetch(`${BASE}/api/stats/carriers`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.carriers)).toBe(true);
    expect(body.carriers.length).toBeGreaterThan(0);
    // Each carrier should have expected fields
    const first = body.carriers[0];
    expect(first).toHaveProperty('code');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('dbRate');
    expect(first).toHaveProperty('vdbRate');
  });
});
