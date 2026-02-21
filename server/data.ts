// =============================================================================
// BTS (Bureau of Transportation Statistics) Data
// Source: DOT Air Travel Consumer Report & T-100 Domestic Segment Data
// =============================================================================

export type CarrierStats = {
  code: string;
  name: string;
  dbRate: number;       // Denied boardings per 10,000 enplanements
  idbRate: number;      // Involuntary denied boardings per 10,000
  vdbRate: number;      // Voluntary denied boardings per 10,000
  loadFactor: number;   // Average load factor (0-1)
  avgCompensation: number; // Average VDB compensation in USD
  oversaleRate: number; // Percentage of flights oversold
};

export const CARRIER_STATS: Record<string, CarrierStats> = {
  DL: { code: 'DL', name: 'Delta', dbRate: 0.17, idbRate: 0.02, vdbRate: 0.15, loadFactor: 0.872, avgCompensation: 1350, oversaleRate: 0.023 },
  AA: { code: 'AA', name: 'American', dbRate: 0.51, idbRate: 0.07, vdbRate: 0.44, loadFactor: 0.845, avgCompensation: 980, oversaleRate: 0.041 },
  UA: { code: 'UA', name: 'United', dbRate: 0.44, idbRate: 0.05, vdbRate: 0.39, loadFactor: 0.868, avgCompensation: 1120, oversaleRate: 0.036 },
  WN: { code: 'WN', name: 'Southwest', dbRate: 0.52, idbRate: 0.04, vdbRate: 0.48, loadFactor: 0.831, avgCompensation: 750, oversaleRate: 0.038 },
  B6: { code: 'B6', name: 'JetBlue', dbRate: 0.44, idbRate: 0.08, vdbRate: 0.36, loadFactor: 0.842, avgCompensation: 890, oversaleRate: 0.034 },
  NK: { code: 'NK', name: 'Spirit', dbRate: 0.93, idbRate: 0.15, vdbRate: 0.78, loadFactor: 0.805, avgCompensation: 620, oversaleRate: 0.062 },
  F9: { code: 'F9', name: 'Frontier', dbRate: 1.23, idbRate: 0.18, vdbRate: 1.05, loadFactor: 0.823, avgCompensation: 580, oversaleRate: 0.071 },
  AS: { code: 'AS', name: 'Alaska', dbRate: 0.34, idbRate: 0.03, vdbRate: 0.31, loadFactor: 0.856, avgCompensation: 1080, oversaleRate: 0.028 },
};

// Route-level load factors for high-demand corridors
export type RouteLoadFactor = {
  origin: string;
  dest: string;
  loadFactor: number;
  peakDays: number[];   // 0=Sun ... 6=Sat
  isLeisure: boolean;
};

export const ROUTE_LOAD_FACTORS: RouteLoadFactor[] = [
  // ATL routes
  { origin: 'ATL', dest: 'LGA', loadFactor: 0.91, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'JFK', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'ORD', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'DFW', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'MCO', loadFactor: 0.85, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'ATL', dest: 'EWR', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'DEN', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'LAS', loadFactor: 0.83, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'ATL', dest: 'CLT', loadFactor: 0.82, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'MIA', loadFactor: 0.86, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'ATL', dest: 'LAX', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'SFO', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'BOS', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'DCA', loadFactor: 0.90, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ATL', dest: 'SEA', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },

  // DFW routes
  { origin: 'DFW', dest: 'ORD', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'LGA', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'EWR', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'LAS', loadFactor: 0.84, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'DFW', dest: 'DEN', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'MCO', loadFactor: 0.83, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'DFW', dest: 'LAX', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'MIA', loadFactor: 0.85, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'DFW', dest: 'JFK', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'ATL', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'CLT', loadFactor: 0.83, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'SFO', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DFW', dest: 'PHX', loadFactor: 0.82, peakDays: [4, 5, 6], isLeisure: true },

  // EWR routes
  { origin: 'EWR', dest: 'ORD', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'DEN', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'LAS', loadFactor: 0.83, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'EWR', dest: 'ATL', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'MCO', loadFactor: 0.84, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'EWR', dest: 'CLT', loadFactor: 0.82, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'LAX', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'SFO', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'DFW', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'EWR', dest: 'MIA', loadFactor: 0.85, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'EWR', dest: 'BOS', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },

  // ORD routes
  { origin: 'ORD', dest: 'LGA', loadFactor: 0.90, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'DEN', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'LAS', loadFactor: 0.83, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'ORD', dest: 'ATL', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'DFW', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'EWR', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'LAX', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'SFO', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'MCO', loadFactor: 0.82, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'ORD', dest: 'MIA', loadFactor: 0.84, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'ORD', dest: 'JFK', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'BOS', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'DCA', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'SEA', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'ORD', dest: 'MSP', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },

  // DEN routes
  { origin: 'DEN', dest: 'LAS', loadFactor: 0.84, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'DEN', dest: 'ORD', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'LGA', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'LAX', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'SFO', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'DFW', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'ATL', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'EWR', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'PHX', loadFactor: 0.82, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'DEN', dest: 'SEA', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'DEN', dest: 'MSP', loadFactor: 0.83, peakDays: [1, 4, 5], isLeisure: false },

  // LGA/JFK routes
  { origin: 'LGA', dest: 'ATL', loadFactor: 0.91, peakDays: [0, 1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'ORD', loadFactor: 0.90, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'DFW', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'DCA', loadFactor: 0.91, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'BOS', loadFactor: 0.88, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'CLT', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'LGA', dest: 'MIA', loadFactor: 0.87, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'LGA', dest: 'MCO', loadFactor: 0.84, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'JFK', dest: 'LAX', loadFactor: 0.92, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'JFK', dest: 'SFO', loadFactor: 0.91, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'JFK', dest: 'ATL', loadFactor: 0.89, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'JFK', dest: 'MCO', loadFactor: 0.85, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'JFK', dest: 'MIA', loadFactor: 0.88, peakDays: [4, 5, 6], isLeisure: true },

  // CLT routes
  { origin: 'CLT', dest: 'LGA', loadFactor: 0.87, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'CLT', dest: 'EWR', loadFactor: 0.85, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'CLT', dest: 'ORD', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'CLT', dest: 'DFW', loadFactor: 0.83, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'CLT', dest: 'BOS', loadFactor: 0.84, peakDays: [1, 4, 5], isLeisure: false },
  { origin: 'CLT', dest: 'MCO', loadFactor: 0.82, peakDays: [0, 5, 6], isLeisure: true },
  { origin: 'CLT', dest: 'MIA', loadFactor: 0.83, peakDays: [4, 5, 6], isLeisure: true },
  { origin: 'CLT', dest: 'DCA', loadFactor: 0.86, peakDays: [1, 4, 5], isLeisure: false },

  // MCO routes
  { origin: 'MCO', dest: 'ATL', loadFactor: 0.85, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'EWR', loadFactor: 0.84, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'ORD', loadFactor: 0.82, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'DFW', loadFactor: 0.83, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'LGA', loadFactor: 0.84, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'JFK', loadFactor: 0.85, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'CLT', loadFactor: 0.82, peakDays: [0, 1], isLeisure: true },
  { origin: 'MCO', dest: 'BOS', loadFactor: 0.83, peakDays: [0, 1], isLeisure: true },

  // LAS routes
  { origin: 'LAS', dest: 'LAX', loadFactor: 0.85, peakDays: [0, 1, 5], isLeisure: true },
  { origin: 'LAS', dest: 'DEN', loadFactor: 0.84, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'DFW', loadFactor: 0.84, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'ORD', loadFactor: 0.83, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'SFO', loadFactor: 0.84, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'EWR', loadFactor: 0.83, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'ATL', loadFactor: 0.83, peakDays: [0, 1], isLeisure: true },
  { origin: 'LAS', dest: 'PHX', loadFactor: 0.82, peakDays: [0, 1], isLeisure: true },
];

// =============================================================================
// Flight Schedule Database
// Realistic schedules for major US hub routes
// =============================================================================

export type AircraftType = {
  name: string;
  iataCode: string;
  capacity: number;
  isRegional: boolean;
};

export const AIRCRAFT_TYPES: Record<string, AircraftType> = {
  'B737':   { name: 'Boeing 737-800', iataCode: '738', capacity: 175, isRegional: false },
  'B737MAX': { name: 'Boeing 737 MAX 8', iataCode: '7M8', capacity: 172, isRegional: false },
  'A320':   { name: 'Airbus A320', iataCode: '320', capacity: 162, isRegional: false },
  'A321':   { name: 'Airbus A321', iataCode: '321', capacity: 196, isRegional: false },
  'A321neo': { name: 'Airbus A321neo', iataCode: '32Q', capacity: 196, isRegional: false },
  'B757':   { name: 'Boeing 757-200', iataCode: '752', capacity: 180, isRegional: false },
  'B767':   { name: 'Boeing 767-300ER', iataCode: '763', capacity: 211, isRegional: false },
  'CRJ900': { name: 'CRJ-900', iataCode: 'CR9', capacity: 76, isRegional: true },
  'E175':   { name: 'Embraer E175', iataCode: 'E75', capacity: 76, isRegional: true },
  'E190':   { name: 'Embraer E190', iataCode: 'E90', capacity: 97, isRegional: true },
  'A319':   { name: 'Airbus A319', iataCode: '319', capacity: 128, isRegional: false },
};

export type ScheduleTemplate = {
  carrier: string;
  carrierName: string;
  origin: string;
  destination: string;
  flightNumBase: number;
  departures: string[];     // HH:MM
  durationMin: number;
  aircraft: string[];       // Keys into AIRCRAFT_TYPES
  daysOfWeek?: number[];    // If absent, daily. 0=Sun...6=Sat
};

export const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  // ===== DELTA (DL) - Hub: ATL =====
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'LGA', flightNumBase: 1400, departures: ['06:00', '07:30', '09:15', '11:00', '13:30', '16:00', '18:30', '20:45'], durationMin: 145, aircraft: ['B737', 'A321', 'B737MAX', 'A321', 'B737', 'A321neo', 'B737', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'JFK', flightNumBase: 1500, departures: ['06:30', '09:00', '12:00', '15:30', '18:00', '20:30'], durationMin: 155, aircraft: ['B757', 'A321', 'B767', 'A321', 'B757', 'A321'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'ORD', flightNumBase: 1600, departures: ['06:45', '09:30', '12:30', '15:00', '18:15'], durationMin: 135, aircraft: ['A321', 'B737', 'A321', 'B737MAX', 'A321'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'DFW', flightNumBase: 1700, departures: ['07:00', '12:15', '17:30'], durationMin: 160, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'MCO', flightNumBase: 1800, departures: ['06:15', '08:30', '11:00', '13:45', '16:30', '19:00'], durationMin: 95, aircraft: ['B737', 'B737MAX', 'A321', 'B737', 'B737MAX', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'EWR', flightNumBase: 1900, departures: ['07:15', '12:30', '18:00'], durationMin: 140, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'DEN', flightNumBase: 2000, departures: ['08:00', '13:00', '17:45'], durationMin: 215, aircraft: ['A321', 'B757', 'A321'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'LAS', flightNumBase: 2100, departures: ['09:30', '16:00'], durationMin: 265, aircraft: ['B757', 'A321neo'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'CLT', flightNumBase: 2200, departures: ['07:00', '13:00', '18:30'], durationMin: 70, aircraft: ['CRJ900', 'E175', 'CRJ900'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'BOS', flightNumBase: 2300, departures: ['06:30', '11:45', '17:00'], durationMin: 170, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'DCA', flightNumBase: 2400, departures: ['06:15', '09:30', '13:00', '16:30', '19:45'], durationMin: 115, aircraft: ['B737', 'A321', 'B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'LAX', flightNumBase: 2500, departures: ['07:00', '10:30', '14:00', '17:30'], durationMin: 280, aircraft: ['B767', 'A321neo', 'B757', 'B767'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'SFO', flightNumBase: 2600, departures: ['08:15', '13:30', '18:00'], durationMin: 300, aircraft: ['B767', 'A321neo', 'B757'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'MIA', flightNumBase: 2700, departures: ['07:30', '12:00', '17:15'], durationMin: 110, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ATL', destination: 'SEA', flightNumBase: 2800, departures: ['08:00', '15:30'], durationMin: 310, aircraft: ['B757', 'A321neo'] },

  // ===== AMERICAN (AA) - Hub: DFW =====
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'ORD', flightNumBase: 300, departures: ['06:00', '08:00', '10:30', '13:00', '16:00', '18:45'], durationMin: 155, aircraft: ['A321', 'B737MAX', 'A321', 'B737', 'A321neo', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'LGA', flightNumBase: 400, departures: ['06:30', '09:00', '12:00', '15:30', '18:30'], durationMin: 195, aircraft: ['A321', 'B737', 'A321', 'A321neo', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'EWR', flightNumBase: 500, departures: ['07:00', '12:30', '18:00'], durationMin: 200, aircraft: ['A321', 'A321neo', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'LAS', flightNumBase: 600, departures: ['08:00', '13:00', '18:30'], durationMin: 195, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'DEN', flightNumBase: 700, departures: ['07:30', '12:00', '17:00'], durationMin: 155, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'MCO', flightNumBase: 800, departures: ['07:00', '12:30', '17:45'], durationMin: 155, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'LAX', flightNumBase: 900, departures: ['06:30', '09:30', '13:00', '16:30', '19:30'], durationMin: 195, aircraft: ['A321', 'B737MAX', 'A321neo', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'MIA', flightNumBase: 1000, departures: ['07:30', '13:00', '18:00'], durationMin: 170, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'JFK', flightNumBase: 1100, departures: ['07:00', '12:00', '17:30'], durationMin: 205, aircraft: ['A321', 'B757', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'ATL', flightNumBase: 1200, departures: ['07:15', '12:30', '18:15'], durationMin: 125, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'SFO', flightNumBase: 1300, departures: ['08:00', '14:00', '19:00'], durationMin: 225, aircraft: ['A321neo', 'A321', 'B757'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'PHX', flightNumBase: 1350, departures: ['07:00', '12:00', '17:00'], durationMin: 170, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'DFW', destination: 'CLT', flightNumBase: 1380, departures: ['06:45', '12:15', '18:00'], durationMin: 140, aircraft: ['A321', 'B737', 'A321'] },

  // ===== AMERICAN (AA) - Hub: CLT =====
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'LGA', flightNumBase: 1450, departures: ['06:15', '09:00', '12:30', '17:00'], durationMin: 120, aircraft: ['A321', 'B737', 'E175', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'EWR', flightNumBase: 1550, departures: ['06:30', '10:00', '14:00', '18:30'], durationMin: 115, aircraft: ['B737', 'CRJ900', 'B737', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'ORD', flightNumBase: 1650, departures: ['07:00', '12:00', '17:30'], durationMin: 145, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'DFW', flightNumBase: 1750, departures: ['07:30', '13:00', '18:15'], durationMin: 180, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'BOS', flightNumBase: 1850, departures: ['06:45', '12:30', '18:00'], durationMin: 135, aircraft: ['B737', 'E175', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'MCO', flightNumBase: 1950, departures: ['07:00', '12:00', '17:30'], durationMin: 100, aircraft: ['B737', 'A319', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'MIA', flightNumBase: 2050, departures: ['07:30', '13:00', '18:00'], durationMin: 130, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'CLT', destination: 'DCA', flightNumBase: 2150, departures: ['06:30', '10:00', '14:00', '18:30'], durationMin: 75, aircraft: ['CRJ900', 'E175', 'CRJ900', 'E175'] },

  // ===== UNITED (UA) - Hub: EWR =====
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'ORD', flightNumBase: 200, departures: ['06:00', '08:30', '11:00', '14:00', '17:00', '19:30'], durationMin: 155, aircraft: ['B737MAX', 'A320', 'B737', 'A321', 'B737MAX', 'A320'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'DEN', flightNumBase: 250, departures: ['07:00', '12:00', '17:30'], durationMin: 260, aircraft: ['B737MAX', 'A321', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'LAS', flightNumBase: 310, departures: ['08:30', '16:00'], durationMin: 315, aircraft: ['B757', 'A321neo'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'ATL', flightNumBase: 350, departures: ['07:30', '12:30', '18:00'], durationMin: 140, aircraft: ['B737', 'A320', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'LAX', flightNumBase: 380, departures: ['06:30', '09:30', '13:00', '17:00', '20:00'], durationMin: 340, aircraft: ['B767', 'B757', 'A321neo', 'B767', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'SFO', flightNumBase: 420, departures: ['07:00', '10:30', '14:30', '18:30'], durationMin: 355, aircraft: ['B767', 'B757', 'A321neo', 'B767'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'MCO', flightNumBase: 460, departures: ['07:30', '12:00', '17:00'], durationMin: 165, aircraft: ['B737', 'A320', 'B737MAX'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'MIA', flightNumBase: 490, departures: ['08:00', '13:30', '18:30'], durationMin: 190, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'BOS', flightNumBase: 510, departures: ['07:00', '12:00', '17:00'], durationMin: 70, aircraft: ['E175', 'CRJ900', 'E175'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'CLT', flightNumBase: 530, departures: ['07:15', '13:00', '18:30'], durationMin: 110, aircraft: ['B737', 'E175', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'DFW', flightNumBase: 550, departures: ['08:00', '13:30', '19:00'], durationMin: 235, aircraft: ['A321', 'B737MAX', 'A321'] },

  // ===== UNITED (UA) - Hub: ORD =====
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'LGA', flightNumBase: 600, departures: ['06:00', '08:30', '11:00', '14:30', '17:30', '20:00'], durationMin: 130, aircraft: ['B737', 'A320', 'B737MAX', 'A321', 'B737', 'A320'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'DEN', flightNumBase: 650, departures: ['06:30', '09:00', '11:30', '14:00', '17:00', '19:30'], durationMin: 195, aircraft: ['A321', 'B737', 'B737MAX', 'A321', 'B737', 'A320'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'LAS', flightNumBase: 700, departures: ['07:30', '13:00', '18:00'], durationMin: 235, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'EWR', flightNumBase: 740, departures: ['06:30', '09:30', '12:30', '15:30', '18:30'], durationMin: 130, aircraft: ['B737MAX', 'A320', 'B737', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'LAX', flightNumBase: 780, departures: ['07:00', '10:00', '13:30', '17:00', '20:00'], durationMin: 255, aircraft: ['B767', 'A321neo', 'B757', 'B767', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'SFO', flightNumBase: 820, departures: ['07:30', '11:00', '14:30', '18:30'], durationMin: 265, aircraft: ['B767', 'A321neo', 'B757', 'B767'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'BOS', flightNumBase: 860, departures: ['07:00', '12:00', '17:30'], durationMin: 145, aircraft: ['B737', 'A320', 'B737MAX'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'DCA', flightNumBase: 880, departures: ['06:30', '09:30', '13:00', '16:30', '19:30'], durationMin: 115, aircraft: ['B737', 'E175', 'B737', 'A320', 'E175'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'ATL', flightNumBase: 900, departures: ['07:00', '12:30', '18:00'], durationMin: 120, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'MCO', flightNumBase: 920, departures: ['07:30', '13:00', '18:30'], durationMin: 170, aircraft: ['B737', 'A321', 'B737MAX'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'SEA', flightNumBase: 940, departures: ['07:00', '13:30', '18:00'], durationMin: 260, aircraft: ['B757', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'MSP', flightNumBase: 960, departures: ['06:30', '10:00', '14:00', '18:00'], durationMin: 90, aircraft: ['E175', 'CRJ900', 'E175', 'CRJ900'] },

  // ===== UNITED (UA) - Hub: DEN =====
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'ORD', flightNumBase: 1000, departures: ['06:00', '08:30', '11:00', '14:00', '17:00', '19:30'], durationMin: 165, aircraft: ['A321', 'B737', 'B737MAX', 'A321', 'B737', 'A320'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'LAS', flightNumBase: 1050, departures: ['07:00', '10:00', '13:30', '17:00'], durationMin: 150, aircraft: ['B737', 'A320', 'B737MAX', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'LGA', flightNumBase: 1100, departures: ['06:30', '11:00', '16:30'], durationMin: 225, aircraft: ['B737MAX', 'A321', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'EWR', flightNumBase: 1150, departures: ['07:00', '12:30', '18:00'], durationMin: 230, aircraft: ['A321', 'B737MAX', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'LAX', flightNumBase: 1200, departures: ['06:30', '09:30', '13:00', '16:30', '19:30'], durationMin: 165, aircraft: ['B737', 'A321', 'B737MAX', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'SFO', flightNumBase: 1250, departures: ['07:00', '10:30', '14:30', '18:30'], durationMin: 175, aircraft: ['B737MAX', 'A321', 'B737', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'DFW', flightNumBase: 1280, departures: ['07:30', '13:00', '18:30'], durationMin: 155, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'ATL', flightNumBase: 1310, departures: ['07:00', '13:00', '18:00'], durationMin: 185, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'SEA', flightNumBase: 1340, departures: ['07:30', '13:30', '18:30'], durationMin: 175, aircraft: ['B737', 'A320', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'PHX', flightNumBase: 1370, departures: ['07:00', '12:00', '17:00'], durationMin: 140, aircraft: ['B737', 'A320', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'MSP', flightNumBase: 1400, departures: ['07:00', '12:30', '18:00'], durationMin: 145, aircraft: ['B737', 'E175', 'B737'] },

  // ===== Cross-carrier competition routes =====
  // UA on ATL routes
  { carrier: 'UA', carrierName: 'United', origin: 'ATL', destination: 'EWR', flightNumBase: 1500, departures: ['08:00', '14:00'], durationMin: 140, aircraft: ['B737', 'A320'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ATL', destination: 'ORD', flightNumBase: 1520, departures: ['08:30', '14:30'], durationMin: 135, aircraft: ['B737', 'A320'] },
  // AA on ATL routes
  { carrier: 'AA', carrierName: 'American', origin: 'ATL', destination: 'DFW', flightNumBase: 2200, departures: ['08:00', '14:00', '19:30'], durationMin: 160, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ATL', destination: 'CLT', flightNumBase: 2250, departures: ['07:30', '12:00', '17:30'], durationMin: 65, aircraft: ['CRJ900', 'E175', 'CRJ900'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ATL', destination: 'ORD', flightNumBase: 2280, departures: ['07:30', '13:30'], durationMin: 135, aircraft: ['B737', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ATL', destination: 'LGA', flightNumBase: 2310, departures: ['08:00', '14:00', '19:00'], durationMin: 145, aircraft: ['E175', 'B737', 'E175'] },
  // DL on DFW/ORD routes
  { carrier: 'DL', carrierName: 'Delta', origin: 'DFW', destination: 'ATL', flightNumBase: 2350, departures: ['07:30', '13:30', '19:00'], durationMin: 125, aircraft: ['B737', 'A321', 'B737'] },
  // AA on EWR/ORD routes
  { carrier: 'AA', carrierName: 'American', origin: 'EWR', destination: 'DFW', flightNumBase: 2400, departures: ['09:00', '15:00'], durationMin: 235, aircraft: ['A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ORD', destination: 'DFW', flightNumBase: 2430, departures: ['07:30', '12:30', '18:00'], durationMin: 160, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ORD', destination: 'LGA', flightNumBase: 2460, departures: ['07:00', '11:00', '15:00', '19:00'], durationMin: 130, aircraft: ['E175', 'B737', 'CRJ900', 'E175'] },

  // Reverse of major routes (return flights)
  { carrier: 'DL', carrierName: 'Delta', origin: 'LGA', destination: 'ATL', flightNumBase: 2500, departures: ['06:00', '08:00', '10:30', '13:00', '15:30', '18:00', '20:30'], durationMin: 155, aircraft: ['B737', 'A321', 'B737MAX', 'A321', 'B737', 'A321neo', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'JFK', destination: 'ATL', flightNumBase: 2550, departures: ['07:00', '10:00', '13:30', '17:00', '20:00'], durationMin: 160, aircraft: ['B757', 'A321', 'B767', 'A321', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'ORD', destination: 'EWR', flightNumBase: 2600, departures: ['06:30', '09:30', '12:30', '15:30', '18:30'], durationMin: 135, aircraft: ['B737MAX', 'A320', 'B737', 'A321', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'ORD', destination: 'DFW', flightNumBase: 2650, departures: ['06:30', '09:30', '13:00', '16:30', '19:30'], durationMin: 160, aircraft: ['A321', 'B737', 'A321', 'B737MAX', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'LAS', destination: 'DEN', flightNumBase: 2700, departures: ['06:30', '10:00', '14:00', '18:00'], durationMin: 145, aircraft: ['B737', 'A320', 'B737MAX', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'MCO', destination: 'ATL', flightNumBase: 2750, departures: ['06:30', '09:00', '11:30', '14:00', '17:00', '19:30'], durationMin: 100, aircraft: ['B737', 'B737MAX', 'A321', 'B737', 'B737MAX', 'B737'] },
  { carrier: 'AA', carrierName: 'American', origin: 'LGA', destination: 'DFW', flightNumBase: 2800, departures: ['07:00', '10:30', '14:00', '17:30', '20:00'], durationMin: 235, aircraft: ['A321', 'B737', 'A321', 'A321neo', 'A321'] },
  { carrier: 'AA', carrierName: 'American', origin: 'LGA', destination: 'CLT', flightNumBase: 2850, departures: ['06:30', '09:30', '13:00', '17:30'], durationMin: 120, aircraft: ['A321', 'B737', 'E175', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'LGA', destination: 'ORD', flightNumBase: 2900, departures: ['06:30', '09:00', '12:00', '15:30', '18:30', '20:30'], durationMin: 155, aircraft: ['B737', 'A320', 'B737MAX', 'A321', 'B737', 'A320'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'ORD', destination: 'ATL', flightNumBase: 2950, departures: ['07:30', '13:00', '18:30'], durationMin: 120, aircraft: ['A321', 'B737', 'A321'] },
  { carrier: 'UA', carrierName: 'United', origin: 'DEN', destination: 'ORD', flightNumBase: 3000, departures: ['06:00', '08:30', '11:00', '14:00', '17:00', '19:30'], durationMin: 165, aircraft: ['A321', 'B737', 'B737MAX', 'A321', 'B737', 'A320'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'EWR', destination: 'ATL', flightNumBase: 3050, departures: ['07:00', '13:00', '18:30'], durationMin: 145, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'UA', carrierName: 'United', origin: 'EWR', destination: 'ORD', flightNumBase: 3100, departures: ['06:00', '08:30', '11:00', '14:00', '17:00', '19:30'], durationMin: 155, aircraft: ['B737MAX', 'A320', 'B737', 'A321', 'B737MAX', 'A320'] },
  { carrier: 'AA', carrierName: 'American', origin: 'EWR', destination: 'CLT', flightNumBase: 3150, departures: ['07:30', '12:30', '18:00'], durationMin: 110, aircraft: ['B737', 'E175', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'BOS', destination: 'ATL', flightNumBase: 3200, departures: ['07:00', '12:30', '17:30'], durationMin: 175, aircraft: ['B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'DCA', destination: 'ATL', flightNumBase: 3250, departures: ['06:30', '10:00', '13:30', '17:00', '20:00'], durationMin: 120, aircraft: ['B737', 'A321', 'B737', 'A321', 'B737'] },
  { carrier: 'DL', carrierName: 'Delta', origin: 'LAX', destination: 'ATL', flightNumBase: 3300, departures: ['07:00', '11:00', '15:00', '19:00'], durationMin: 255, aircraft: ['B767', 'A321neo', 'B757', 'B767'] },
  { carrier: 'UA', carrierName: 'United', origin: 'LAX', destination: 'EWR', flightNumBase: 3350, departures: ['06:30', '09:30', '13:00', '17:00', '20:00'], durationMin: 305, aircraft: ['B767', 'B757', 'A321neo', 'B767', 'B757'] },
  { carrier: 'UA', carrierName: 'United', origin: 'SFO', destination: 'EWR', flightNumBase: 3400, departures: ['07:00', '11:00', '15:00', '19:00'], durationMin: 320, aircraft: ['B767', 'B757', 'A321neo', 'B767'] },
];

// Airport ICAO codes mapping
export const AIRPORT_ICAO: Record<string, string> = {
  'ATL': 'KATL', 'DFW': 'KDFW', 'EWR': 'KEWR', 'ORD': 'KORD',
  'DEN': 'KDEN', 'LAS': 'KLAS', 'LGA': 'KLGA', 'JFK': 'KJFK',
  'MCO': 'KMCO', 'CLT': 'KCLT', 'LAX': 'KLAX', 'SFO': 'KSFO',
  'BOS': 'KBOS', 'MIA': 'KMIA', 'DCA': 'KDCA', 'SEA': 'KSEA',
  'PHX': 'KPHX', 'MSP': 'KMSP', 'DTW': 'KDTW', 'IAH': 'KIAH',
};

export const ALL_HUBS = ['ATL', 'DFW', 'EWR', 'ORD', 'DEN', 'LAS', 'LGA', 'JFK', 'MCO', 'CLT'];

// Quarterly BTS denied boarding trends (for historical analysis)
export type QuarterlyStats = {
  quarter: string;
  totalEnplanements: number;
  voluntaryDB: number;
  involuntaryDB: number;
  avgCompensation: number;
};

export const QUARTERLY_TRENDS: QuarterlyStats[] = [
  { quarter: '2024 Q1', totalEnplanements: 207_000_000, voluntaryDB: 15_420, involuntaryDB: 2_870, avgCompensation: 990 },
  { quarter: '2024 Q2', totalEnplanements: 231_000_000, voluntaryDB: 18_550, involuntaryDB: 3_210, avgCompensation: 1050 },
  { quarter: '2024 Q3', totalEnplanements: 248_000_000, voluntaryDB: 22_100, involuntaryDB: 3_780, avgCompensation: 1120 },
  { quarter: '2024 Q4', totalEnplanements: 221_000_000, voluntaryDB: 16_800, involuntaryDB: 2_950, avgCompensation: 1080 },
  { quarter: '2025 Q1', totalEnplanements: 213_000_000, voluntaryDB: 16_100, involuntaryDB: 2_810, avgCompensation: 1030 },
  { quarter: '2025 Q2', totalEnplanements: 238_000_000, voluntaryDB: 19_200, involuntaryDB: 3_350, avgCompensation: 1100 },
  { quarter: '2025 Q3', totalEnplanements: 255_000_000, voluntaryDB: 23_400, involuntaryDB: 3_900, avgCompensation: 1180 },
  { quarter: '2025 Q4', totalEnplanements: 228_000_000, voluntaryDB: 17_500, involuntaryDB: 3_050, avgCompensation: 1120 },
];

// Top oversold routes (from BTS data analysis)
export type OversoldRoute = {
  origin: string;
  destination: string;
  carrier: string;
  carrierName: string;
  avgOversaleRate: number; // percentage of flights oversold
  avgBumps: number;        // average bumped passengers per oversold flight
  avgCompensation: number;
};

export const TOP_OVERSOLD_ROUTES: OversoldRoute[] = [
  { origin: 'ATL', destination: 'LGA', carrier: 'DL', carrierName: 'Delta', avgOversaleRate: 4.2, avgBumps: 2.8, avgCompensation: 1350 },
  { origin: 'DFW', destination: 'ORD', carrier: 'AA', carrierName: 'American', avgOversaleRate: 5.1, avgBumps: 3.2, avgCompensation: 980 },
  { origin: 'EWR', destination: 'ORD', carrier: 'UA', carrierName: 'United', avgOversaleRate: 4.8, avgBumps: 2.9, avgCompensation: 1120 },
  { origin: 'ORD', destination: 'LGA', carrier: 'UA', carrierName: 'United', avgOversaleRate: 5.5, avgBumps: 3.5, avgCompensation: 1200 },
  { origin: 'ATL', destination: 'DCA', carrier: 'DL', carrierName: 'Delta', avgOversaleRate: 4.0, avgBumps: 2.5, avgCompensation: 1400 },
  { origin: 'CLT', destination: 'LGA', carrier: 'AA', carrierName: 'American', avgOversaleRate: 5.3, avgBumps: 3.1, avgCompensation: 950 },
  { origin: 'DFW', destination: 'LGA', carrier: 'AA', carrierName: 'American', avgOversaleRate: 4.9, avgBumps: 2.7, avgCompensation: 1050 },
  { origin: 'JFK', destination: 'LAX', carrier: 'DL', carrierName: 'Delta', avgOversaleRate: 3.8, avgBumps: 2.2, avgCompensation: 1500 },
  { origin: 'ORD', destination: 'DCA', carrier: 'UA', carrierName: 'United', avgOversaleRate: 4.6, avgBumps: 2.8, avgCompensation: 1150 },
  { origin: 'ATL', destination: 'MCO', carrier: 'DL', carrierName: 'Delta', avgOversaleRate: 3.5, avgBumps: 2.0, avgCompensation: 900 },
  { origin: 'DFW', destination: 'LAX', carrier: 'AA', carrierName: 'American', avgOversaleRate: 4.4, avgBumps: 2.6, avgCompensation: 1100 },
  { origin: 'EWR', destination: 'LAX', carrier: 'UA', carrierName: 'United', avgOversaleRate: 4.1, avgBumps: 2.4, avgCompensation: 1250 },
  { origin: 'CLT', destination: 'DCA', carrier: 'AA', carrierName: 'American', avgOversaleRate: 5.8, avgBumps: 3.4, avgCompensation: 850 },
  { origin: 'ATL', destination: 'ORD', carrier: 'DL', carrierName: 'Delta', avgOversaleRate: 3.9, avgBumps: 2.3, avgCompensation: 1300 },
  { origin: 'ORD', destination: 'SFO', carrier: 'UA', carrierName: 'United', avgOversaleRate: 4.3, avgBumps: 2.5, avgCompensation: 1180 },
];
