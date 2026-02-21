import React, { useState, useEffect } from 'react';
import { 
  Plane, 
  Search, 
  AlertTriangle, 
  DollarSign, 
  Clock, 
  Calendar, 
  MapPin, 
  ChevronRight, 
  CheckCircle2, 
  TrendingUp,
  ShieldAlert,
  Crosshair,
  BookOpen,
  Bell,
  History,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Mock Data & Types ---

type Flight = {
  id: string;
  airline: string;
  flightNumber: string;
  departure: string;
  arrival: string;
  depTime: string;
  arrTime: string;
  aircraft: string;
  price: number;
  bumpScore: number;
  factors: string[];
};

const MOCK_ALERTS = [
  { id: 1, hub: 'EWR', reason: 'Morning Thunderstorms', impact: 'High cascading delays. Evening flights 80%+ full.', color: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  { id: 2, hub: 'ATL', reason: 'System Outage Recovery', impact: 'Rebooking misconnected passengers. Target 8PM-10PM bank.', color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  { id: 3, hub: 'DFW', reason: 'Extreme Heat', impact: 'Regional jets weight-restricted. Guaranteed bumps on CRJ/E175s.', color: 'text-rose-500', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
];

const ALL_HUBS = ['ATL', 'DFW', 'EWR', 'ORD', 'DEN', 'LAS', 'LGA', 'JFK', 'MCO', 'CLT'];

const generateMockFlights = (origin: string, dest: string, date: string): Flight[] => {
  const airlines = ['Delta', 'American', 'United'];
  const aircrafts = ['Boeing 737', 'Airbus A321', 'CRJ-900 (Regional)', 'Embraer 175'];
  
  // Algorithmic Fix: Incorporate real-world constraints like Day of Week and Active Alerts
  const d = date ? new Date(date + 'T12:00:00') : new Date();
  const dayOfWeek = d.getDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
  const isPrimeBusinessDay = dayOfWeek === 1 || dayOfWeek === 4 || dayOfWeek === 5; // Mon, Thu, Fri
  const isWeekendLeisure = dayOfWeek === 0 || dayOfWeek === 6; // Sun, Sat
  
  const hasOriginAlert = MOCK_ALERTS.some(a => a.hub === origin.toUpperCase());
  const hasDestAlert = MOCK_ALERTS.some(a => a.hub === dest.toUpperCase());

  return Array.from({ length: 6 }).map((_, i) => {
    const isEvening = i > 3;
    const isRegional = i % 3 === 0;
    const airline = airlines[i % 3];
    
    let score = 30 + Math.floor(Math.random() * 15); // Base 30-45
    const factors = [];
    
    if (isEvening) {
      score += 15;
      factors.push('Last bank of the day');
    }
    if (isRegional) {
      score += 20;
      factors.push('Weight-restricted regional jet');
    }
    if (airline === 'Delta' && origin.toUpperCase() === 'ATL') {
      score += 10;
      factors.push('Fortress Hub dynamics');
    }
    
    // Algorithmic Fix: Adjust score based on day of week and route type
    if (isPrimeBusinessDay && !isWeekendLeisure) {
      score += 15;
      factors.push('Prime business travel day');
    } else if (isWeekendLeisure && (dest.toUpperCase() === 'LAS' || dest.toUpperCase() === 'MCO' || dest.toUpperCase() === 'CUN')) {
      score += 20;
      factors.push('Heavy leisure route weekend');
    }

    // Algorithmic Fix: Massive boost if there is an active network disruption
    if (hasOriginAlert) {
      score += 25;
      factors.push('Origin network disruption');
    } else if (hasDestAlert) {
      score += 15;
      factors.push('Destination network disruption');
    }
    
    score = Math.min(98, score); // Cap at 98%

    return {
      id: `FL-${Math.floor(Math.random() * 10000)}`,
      airline,
      flightNumber: `${airline.charAt(0)}${Math.floor(Math.random() * 9000) + 1000}`,
      departure: origin.toUpperCase(),
      arrival: dest.toUpperCase(),
      depTime: isEvening ? `1${8 + i - 3}:30` : `0${6 + i}:15`,
      arrTime: isEvening ? `2${0 + i - 3}:45` : `0${8 + i}:30`,
      aircraft: isRegional ? aircrafts[2] : aircrafts[i % 2],
      price: 189 + Math.floor(Math.random() * 300),
      bumpScore: score,
      factors,
    };
  }).sort((a, b) => b.bumpScore - a.bumpScore);
};

// --- Components ---

function Dashboard({ setActiveTab }: { setActiveTab: (t: string) => void }) {
  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Command Center</h1>
        <p className="text-slate-400 mt-1">Real-time network vulnerabilities and active alerts.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-400">Total Bounties Claimed</p>
              <h3 className="text-2xl font-bold text-slate-50 mt-1">$3,450</h3>
            </div>
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-emerald-400">
            <TrendingUp className="w-4 h-4 mr-1" />
            <span>+2 successful bumps this year</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-400">Active Network Alerts</p>
              <h3 className="text-2xl font-bold text-slate-50 mt-1">3 Hubs</h3>
            </div>
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-slate-400">
            <span>High probability conditions detected</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 cursor-pointer hover:bg-slate-800 transition-colors" onClick={() => setActiveTab('scanner')}>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-400">Next Hunt</p>
              <h3 className="text-xl font-bold text-slate-50 mt-1">Find Flights</h3>
            </div>
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Crosshair className="w-5 h-5 text-indigo-400" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-indigo-400">
            <span>Launch Scanner</span>
            <ChevronRight className="w-4 h-4 ml-1" />
          </div>
        </div>
      </div>

      <h2 className="text-xl font-semibold text-slate-50 mt-8 mb-4">Live Network Disruptions</h2>
      <div className="grid grid-cols-1 gap-4">
        {MOCK_ALERTS.map((alert) => (
          <div key={alert.id} className={`p-4 rounded-xl border ${alert.bg} ${alert.border} flex items-start space-x-4`}>
            <div className={`p-2 rounded-full bg-slate-950/50 ${alert.color}`}>
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h4 className={`font-semibold ${alert.color}`}>{alert.hub} - {alert.reason}</h4>
              <p className="text-slate-300 text-sm mt-1">{alert.impact}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Scanner() {
  const [origin, setOrigin] = useState('ATL');
  const [dest, setDest] = useState('LGA');
  const [date, setDate] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<Flight[]>([]);
  const [monitoredHubs, setMonitoredHubs] = useState<string[]>(['ATL', 'EWR', 'DFW']);

  const toggleHub = (hub: string) => {
    setMonitoredHubs(prev => 
      prev.includes(hub) ? prev.filter(h => h !== hub) : [...prev, hub]
    );
  };

  const activeAlerts = MOCK_ALERTS.filter(alert => monitoredHubs.includes(alert.hub));

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    setResults([]);
    
    // Simulate API call and scoring algorithm
    setTimeout(() => {
      setResults(generateMockFlights(origin, dest, date));
      setIsSearching(false);
    }, 1500);
  };

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Flight Scanner</h1>
        <p className="text-slate-400 mt-1">Identify flights with the highest probability of overbooking.</p>
      </header>

      {/* NEW SECTION: Live Network Disruptions */}
      <div className="mb-8 bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-50 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" />
            Live Network Disruptions
          </h2>
          <button className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
            <Bell className="w-4 h-4 mr-1" />
            Alert Settings
          </button>
        </div>
        
        <div className="mb-6">
          <p className="text-sm text-slate-400 mb-3">Select hubs to monitor for active vulnerabilities:</p>
          <div className="flex flex-wrap gap-2">
            {ALL_HUBS.map(hub => (
              <button
                key={hub}
                onClick={() => toggleHub(hub)}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  monitoredHubs.includes(hub)
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/20'
                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:border-slate-700 hover:text-slate-300'
                }`}
              >
                {hub}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {activeAlerts.length > 0 ? (
            activeAlerts.map(alert => (
              <div key={alert.id} className={`p-4 rounded-xl border ${alert.bg} ${alert.border} flex items-start space-x-4`}>
                <div className={`p-2 rounded-full bg-slate-950/50 ${alert.color}`}>
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h4 className={`font-semibold ${alert.color}`}>{alert.hub} - {alert.reason}</h4>
                  <p className="text-slate-300 text-sm mt-1">{alert.impact}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full p-6 rounded-xl border border-slate-800 border-dashed bg-slate-950/50 text-center">
              <CheckCircle2 className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400">No active disruptions for your monitored hubs.</p>
              <p className="text-slate-500 text-sm mt-1">Operations are running normally.</p>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSearch} className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Origin Hub</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input 
                type="text" 
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-slate-50 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 uppercase"
                placeholder="e.g. ATL"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Destination</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input 
                type="text" 
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-slate-50 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 uppercase"
                placeholder="e.g. LGA"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input 
                type="date" 
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg py-2.5 pl-10 pr-4 text-slate-50 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 [color-scheme:dark]"
                required
              />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button 
            type="submit" 
            disabled={isSearching}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-lg font-medium flex items-center transition-colors disabled:opacity-50"
          >
            {isSearching ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
            ) : (
              <Search className="w-5 h-5 mr-2" />
            )}
            {isSearching ? 'Analyzing Network...' : 'Scan Flights'}
          </button>
        </div>
      </form>

      <AnimatePresence>
        {results.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <h3 className="text-lg font-semibold text-slate-50 mb-4">Target Opportunities</h3>
            {results.map((flight, idx) => (
              <div key={flight.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                      <Plane className="w-6 h-6 text-indigo-400" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-50">{flight.airline} {flight.flightNumber}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">{flight.aircraft}</span>
                      </div>
                      <div className="text-sm text-slate-400 mt-1 flex items-center space-x-2">
                        <span>{flight.departure} {flight.depTime}</span>
                        <ChevronRight className="w-4 h-4" />
                        <span>{flight.arrival} {flight.arrTime}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col md:items-end">
                    <div className="flex items-center space-x-3">
                      <div className="text-right">
                        <p className="text-xs text-slate-400 uppercase tracking-wider">Bump Probability</p>
                        <p className={`text-2xl font-bold ${flight.bumpScore > 80 ? 'text-emerald-400' : flight.bumpScore > 60 ? 'text-amber-400' : 'text-slate-300'}`}>
                          {flight.bumpScore}%
                        </p>
                      </div>
                      <div className="w-16 h-16 relative">
                        {/* Simple circular progress */}
                        <svg className="w-full h-full" viewBox="0 0 36 36">
                          <path
                            className="text-slate-800"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                          <path
                            className={flight.bumpScore > 80 ? 'text-emerald-500' : flight.bumpScore > 60 ? 'text-amber-500' : 'text-indigo-500'}
                            strokeDasharray={`${flight.bumpScore}, 100`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          />
                        </svg>
                      </div>
                    </div>
                  </div>

                </div>
                
                <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap gap-2">
                  {flight.factors.map((factor, i) => (
                    <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-slate-950 text-slate-400 border border-slate-800">
                      {factor}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const MOCK_HISTORY = [
  { id: 1, date: 'Today', flight: 'DL 1432', route: 'ATL → LGA', predictedScore: 92, actualOversold: 4, maxCompensation: 1200, status: 'Confirmed VDB' },
  { id: 2, date: 'Yesterday', flight: 'AA 342', route: 'DFW → ORD', predictedScore: 85, actualOversold: 2, maxCompensation: 800, status: 'Confirmed VDB' },
  { id: 3, date: 'Yesterday', flight: 'UA 112', route: 'EWR → BOS', predictedScore: 88, actualOversold: 0, maxCompensation: 0, status: 'Cleared at Gate' },
  { id: 4, date: '3 days ago', flight: 'DL 890', route: 'ATL → MCO', predictedScore: 75, actualOversold: 1, maxCompensation: 500, status: 'Confirmed VDB' },
  { id: 5, date: '4 days ago', flight: 'AA 1209', route: 'CLT → EWR', predictedScore: 94, actualOversold: 6, maxCompensation: 1500, status: 'Confirmed VDB' },
  { id: 6, date: '5 days ago', flight: 'DL 234', route: 'JFK → LAX', predictedScore: 60, actualOversold: 0, maxCompensation: 0, status: 'Cleared at Gate' },
  { id: 7, date: '6 days ago', flight: 'UA 444', route: 'DEN → LAS', predictedScore: 82, actualOversold: 3, maxCompensation: 1000, status: 'Confirmed VDB' },
  { id: 8, date: '12 days ago', flight: 'DL 992', route: 'ATL → DCA', predictedScore: 96, actualOversold: 8, maxCompensation: 2000, status: 'Confirmed VDB' },
  { id: 9, date: '15 days ago', flight: 'AA 555', route: 'MIA → JFK', predictedScore: 70, actualOversold: 0, maxCompensation: 0, status: 'Cleared at Gate' },
  { id: 10, date: '21 days ago', flight: 'UA 777', route: 'ORD → SFO', predictedScore: 89, actualOversold: 2, maxCompensation: 600, status: 'Confirmed VDB' },
];

function HistoricalAnalysis() {
  const [daysBack, setDaysBack] = useState(7);

  const filteredHistory = MOCK_HISTORY.filter(record => {
    if (daysBack === 30) return true;
    if (daysBack === 7) return record.id <= 7;
    if (daysBack === 3) return record.id <= 4;
    return true;
  });

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Historical Analysis</h1>
        <p className="text-slate-400 mt-1">Verify strategy performance by tracking predicted vs. actual overbooked flights.</p>
      </header>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
          <h2 className="text-xl font-semibold text-slate-50">Recent VDB Outcomes</h2>
          <div className="flex space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {[3, 7, 30].map(days => (
              <button
                key={days}
                onClick={() => setDaysBack(days)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  daysBack === days
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {days} Days
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="text-xs text-slate-500 uppercase bg-slate-950/80 border-y border-slate-800">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Flight</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium text-center">Predicted Score</th>
                <th className="px-4 py-3 font-medium text-center">Actual Oversold</th>
                <th className="px-4 py-3 font-medium text-right">Max Payout</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {filteredHistory.map((record) => (
                <tr key={record.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-4 whitespace-nowrap">{record.date}</td>
                  <td className="px-4 py-4 font-medium text-slate-300">{record.flight}</td>
                  <td className="px-4 py-4">{record.route}</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      record.predictedScore >= 90 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                      record.predictedScore >= 80 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {record.predictedScore}%
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center font-mono text-slate-300">
                    {record.actualOversold > 0 ? `+${record.actualOversold}` : '0'}
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-emerald-400">
                    {record.maxCompensation > 0 ? `$${record.maxCompensation}` : '-'}
                  </td>
                  <td className="px-4 py-4">
                    {record.status === 'Confirmed VDB' ? (
                      <span className="flex items-center text-emerald-400 text-xs font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> VDB Paid
                      </span>
                    ) : (
                      <span className="flex items-center text-slate-500 text-xs font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Cleared
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Playbook() {
  const steps = [
    {
      time: 'Booking Phase',
      title: 'Strategic Booking',
      desc: 'Book Main Cabin (Economy). Do NOT book Basic Economy. Skip seat selection entirely if the airline allows it. You want a "Seat Assigned at Gate" status.',
      icon: <Calendar className="w-5 h-5 text-indigo-400" />
    },
    {
      time: 'T-24 Hours',
      title: 'The App Check-in Bid',
      desc: 'Check in exactly 24 hours prior. If prompted to volunteer, bid low (e.g., $200). This does NOT lock your price; it just puts you at the top of the list. You will get the highest amount offered to any volunteer.',
      icon: <Clock className="w-5 h-5 text-amber-400" />
    },
    {
      time: 'T-75 Minutes',
      title: 'The Gate Agent Approach',
      desc: 'Arrive before the boarding rush. Smile and say: "Hi, I saw on the app this flight might be oversold. I have total flexibility today. If you need volunteers, you can put my name at the top of your list."',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />
    },
    {
      time: 'T-45 Minutes',
      title: 'The Negotiation',
      desc: 'When called, ask for the rebooking FIRST ("What flight can you confirm me on?"). If it\'s the next day, demand hotel, meal, and Uber vouchers. Ask politely for a First Class upgrade on the new flight.',
      icon: <DollarSign className="w-5 h-5 text-emerald-400" />
    }
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">The Playbook</h1>
        <p className="text-slate-400 mt-1">Step-by-step execution guide to secure maximum compensation.</p>
      </header>

      <div className="relative border-l border-slate-800 ml-4 space-y-8 pb-8">
        {steps.map((step, idx) => (
          <div key={idx} className="relative pl-8">
            <div className="absolute -left-4 top-0 w-8 h-8 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center">
              {step.icon}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 mb-1 block">
                {step.time}
              </span>
              <h3 className="text-lg font-semibold text-slate-50 mb-2">{step.title}</h3>
              <p className="text-slate-400 leading-relaxed text-sm">
                {step.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 flex-shrink-0">
        <div className="p-6">
          <div className="flex items-center space-x-2 text-indigo-400 mb-8">
            <Plane className="w-8 h-8" />
            <span className="text-xl font-bold tracking-tight text-slate-50">BumpHunter</span>
          </div>
          
          <nav className="space-y-2">
            {[
              { id: 'dashboard', label: 'Command Center', icon: <TrendingUp className="w-5 h-5" /> },
              { id: 'scanner', label: 'Flight Scanner', icon: <Search className="w-5 h-5" /> },
              { id: 'history', label: 'Historical Analysis', icon: <History className="w-5 h-5" /> },
              { id: 'playbook', label: 'The Playbook', icon: <BookOpen className="w-5 h-5" /> },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                  activeTab === item.id 
                    ? 'bg-indigo-600/10 text-indigo-400 font-medium' 
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {activeTab === 'dashboard' && <Dashboard setActiveTab={setActiveTab} />}
          {activeTab === 'scanner' && <Scanner />}
          {activeTab === 'history' && <HistoricalAnalysis />}
          {activeTab === 'playbook' && <Playbook />}
        </div>
      </main>
    </div>
  );
}
