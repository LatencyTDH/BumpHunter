import express from 'express';
import dotenv from 'dotenv';
import { registerRoutes } from './routes.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3001;

registerRoutes(app);

// =============================================================================
// Start server
// =============================================================================
app.listen(PORT, () => {
  console.log(`🛫 BumpHunter API running on http://localhost:${PORT}`);
  console.log('   Data sources: FlightRadar24, OpenSky Network, ADSBDB, aviationweather.gov, FAA NASSTATUS, DOT BTS');
  console.log('   NO fake data. NO schedule templates. Real flights only.');
  console.log('   Endpoints:');
  console.log('     GET /api/health');
  console.log('     GET /api/weather/alerts');
  console.log('     GET /api/weather/metar');
  console.log('     GET /api/faa/status');
  console.log('     GET /api/flights/search');
  console.log('     GET /api/stats/carriers');
  console.log('     GET /api/stats/trends');
  console.log('     GET /api/stats/routes');
  console.log('     GET /api/stats/summary');
});
