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
  ChevronDown,
  CheckCircle2,
  TrendingUp,
  ShieldAlert,
  Crosshair,
  BookOpen,
  Bell,
  History,
  BarChart3,
  Activity,
  Database,
  Loader2,
  ExternalLink,
  Radio,
  Info,
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  searchFlights,
  getWeatherAlerts,
  getSummary,
  getCarrierStats,
  getQuarterlyTrends,
  getTopRoutes,
  getFAAStatus,
  type Flight,
  type FactorDetail,
  type WeatherAlert,
  type SummaryData,
  type CarrierStats,
  type QuarterlyTrend,
  type OversoldRoute,
  type FlightSearchMeta,
  type FAAStatus,
} from './api';

// --- Components ---

const ALL_HUBS = ['ATL', 'DFW', 'EWR', 'ORD', 'DEN', 'LAS', 'LGA', 'JFK', 'MCO', 'CLT'];

function DataSourceBadge({ sources }: { sources?: string[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="flex items-center flex-wrap gap-2 mt-2">
      <Database className="w-3.5 h-3.5 text-slate-500" />
      {sources.map((s, i) => (
        <span key={i} className="text-xs text-slate-500 bg-slate-900/50 px-2 py-0.5 rounded-full border border-slate-800/50">
          {s}
        </span>
      ))}
    </div>
  );
}

function VerificationBadge({ flight }: { flight: Flight }) {
  if (flight.verified) {
    const label = flight.verificationSource === 'fr24-schedule' ? 'Scheduled · FR24' :
                  flight.verificationSource === 'fr24-live' ? 'Live · FR24' :
                  flight.verificationSource === 'adsbdb' ? 'Verified · ADSBDB' :
                  'Verified';
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        {flight.dataSource === 'fr24-live' ? <Radio className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
        {label}
      </span>
    );
  }
  if (flight.verificationSource === 'opensky-estimate') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
        <Info className="w-3 h-3" />
        Estimated Route
      </span>
    );
  }
  return null;
}

function FlightStatusBadge({ status }: { status: string }) {
  if (!status) return null;
  const lower = status.toLowerCase();
  const isInAir = lower === 'in air' || lower.includes('airborne');
  const isDelayed = lower.includes('delay');
  const isLanded = lower.includes('landed');
  const isCanceled = lower.includes('cancel');

  let classes = 'bg-slate-800 text-slate-300';
  if (isInAir) classes = 'bg-sky-500/10 text-sky-400 border border-sky-500/20';
  else if (isDelayed) classes = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
  else if (isLanded) classes = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  else if (isCanceled) classes = 'bg-rose-500/10 text-rose-400 border border-rose-500/20';

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${classes}`}>
      {isInAir && <Radio className="w-3 h-3 animate-pulse" />}
      {status}
    </span>
  );
}

function RateLimitBanner({ meta }: { meta: FlightSearchMeta }) {
  if (meta.totalFlights > 0 && !meta.rateLimited && !meta.message) return null;

  // No flights but not rate limited — just no flights on route
  if (meta.totalFlights === 0 && !meta.rateLimited) {
    return (
      <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-amber-300">No flights found</p>
          <p className="text-sm text-amber-200/70 mt-1">
            {meta.message || `No real-time flights found for ${meta.origin}→${meta.destination}. This route may not have active flights right now.`}
          </p>
          <p className="text-xs text-amber-200/50 mt-2">
            BumpHunter only shows real, verified flights — never fabricated data.
          </p>
        </div>
      </div>
    );
  }

  // Rate limited
  if (meta.rateLimited) {
    return (
      <div className="p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-orange-300">⚠️ Real-time flight data temporarily unavailable</p>
          <p className="text-sm text-orange-200/70 mt-1">
            Our data sources (FlightRadar24 and OpenSky Network) are temporarily rate limited. Try again in a few minutes.
          </p>
          <p className="text-xs text-orange-200/50 mt-2">
            BumpHunter never shows fake data. When real data isn't available, we tell you honestly.
          </p>
        </div>
      </div>
    );
  }

  // Partial data (e.g. OpenSky rate limited but FR24 working)
  if (meta.message && meta.openskyRateLimited && meta.totalFlights > 0) {
    return (
      <div className="p-3 rounded-lg border border-blue-500/20 bg-blue-500/5 flex items-center space-x-2">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <p className="text-sm text-blue-300">{meta.message}</p>
      </div>
    );
  }

  return null;
}

function FAADelayBanner({ originStatus, destStatus }: { originStatus: FAAStatus | null; destStatus: FAAStatus | null }) {
  const statuses = [originStatus, destStatus].filter(
    (s): s is FAAStatus => s !== null && s.delay === true
  );
  if (statuses.length === 0) return null;

  return (
    <div className="space-y-2">
      {statuses.map((s) => {
        const isGroundStop = s.delayType === 'GS' || s.delayType === 'CLOSURE';
        const isGDP = s.delayType === 'GDP';
        // Red for Ground Stop/Closure, Orange for GDP, Yellow for general delays
        const borderColor = isGroundStop ? 'border-rose-500/20' : isGDP ? 'border-orange-500/20' : 'border-yellow-500/20';
        const bgColor = isGroundStop ? 'bg-rose-500/10' : isGDP ? 'bg-orange-500/10' : 'bg-yellow-500/10';
        const textColor = isGroundStop ? 'text-rose-400' : isGDP ? 'text-orange-400' : 'text-yellow-400';
        const iconColor = isGroundStop ? 'text-rose-500' : isGDP ? 'text-orange-500' : 'text-yellow-500';
        const label = isGroundStop
          ? (s.delayType === 'CLOSURE' ? 'Airport Closure' : 'Ground Stop')
          : isGDP
          ? 'Ground Delay Program'
          : 'Airport Delays';

        return (
          <div key={`faa-${s.airport}`} className={`p-4 rounded-xl border ${borderColor} ${bgColor} flex items-start space-x-3`}>
            <AlertTriangle className={`w-5 h-5 ${iconColor} mt-0.5 flex-shrink-0`} />
            <div>
              <div className="flex items-center gap-2">
                <p className={`font-semibold ${textColor}`}>
                  ✈️ FAA {label} — {s.airport}
                </p>
                <span className={`text-xs px-2 py-0.5 rounded-full ${bgColor} ${textColor} border ${borderColor}`}>
                  {s.delayType}
                </span>
              </div>
              <p className={`text-sm mt-1 ${textColor} opacity-80`}>
                {s.reason || label}
                {s.avgDelay ? ` · ${s.avgDelay}` : ''}
              </p>
              <p className="text-xs text-slate-500 mt-1">Source: FAA NASSTATUS</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSpinner({ text }: { text?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 text-indigo-400 animate-spin mr-3" />
      <span className="text-slate-400">{text || 'Loading...'}</span>
    </div>
  );
}

// --- Score color utility ---

function getScoreColor(score: number, maxScore: number): string {
  const pct = (score / maxScore) * 100;
  if (pct >= 80) return 'text-rose-400';
  if (pct >= 60) return 'text-orange-400';
  if (pct >= 30) return 'text-amber-400';
  return 'text-sky-400';
}

function getScoreBarBg(score: number, maxScore: number): string {
  const pct = (score / maxScore) * 100;
  if (pct >= 80) return 'bg-rose-500';
  if (pct >= 60) return 'bg-orange-500';
  if (pct >= 30) return 'bg-amber-500';
  return 'bg-sky-500';
}

function getScoreStroke(score: number): string {
  if (score >= 80) return '#ef4444';  // red
  if (score >= 60) return '#f97316';  // orange
  if (score >= 30) return '#eab308';  // yellow
  return '#3b82f6';                   // blue
}

function getScoreTextColor(score: number): string {
  if (score >= 80) return 'text-rose-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 30) return 'text-amber-400';
  return 'text-sky-400';
}

// --- Score Ring (SVG donut) ---

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const strokeColor = getScoreStroke(score);
  const textColor = getScoreTextColor(score);
  // SVG circle math — radius 15.9155 gives circumference ~100
  const dashArray = `${score}, 100`;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
        <circle
          cx="18" cy="18" r="15.9155"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-slate-800"
        />
        <circle
          cx="18" cy="18" r="15.9155"
          fill="none"
          stroke={strokeColor}
          strokeWidth="3"
          strokeDasharray={dashArray}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold ${textColor}`}>{score}</span>
      </div>
    </div>
  );
}

// --- Score Breakdown Bars (collapsible) ---

function ScoreBreakdown({ factors }: { factors: FactorDetail[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4 pt-4 border-t border-slate-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between py-2 px-1 text-sm text-slate-400 hover:text-slate-200 transition-colors active:bg-slate-800/30 rounded-lg -mx-1"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" />
          {expanded ? 'Hide breakdown' : 'Show breakdown'}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="space-y-3">
            {factors.map((factor, i) => {
              const pct = Math.round((factor.score / factor.maxScore) * 100);
              return (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-slate-300">{factor.name}</span>
                    <span className={`text-xs font-mono ${getScoreColor(factor.score, factor.maxScore)}`}>
                      {factor.score}/{factor.maxScore}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${getScoreBarBg(factor.score, factor.maxScore)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{factor.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ setActiveTab }: { setActiveTab: (t: string) => void }) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSummary()
      .then(setSummary)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner text="Fetching live data from aviationweather.gov..." />;

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Command Center</h1>
        <p className="text-slate-400 mt-1">Real-time network vulnerabilities and active weather disruptions.</p>
        {error && (
          <p className="text-amber-400 text-sm mt-2 flex items-center">
            <AlertTriangle className="w-4 h-4 mr-1" />
            Backend unavailable — showing cached data
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-400">Industry Avg VDB Payout</p>
              <h3 className="text-2xl font-bold text-slate-50 mt-1">${summary?.avgCompensation?.toLocaleString() || '---'}</h3>
            </div>
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-emerald-400">
            <TrendingUp className="w-4 h-4 mr-1" />
            <span>{summary ? `${summary.totalVDBTwoYears.toLocaleString()} VDBs in 8 quarters` : '---'}</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-400">Active Weather Disruptions</p>
              <h3 className="text-2xl font-bold text-slate-50 mt-1">
                {summary ? `${summary.activeAlerts} Hub${summary.activeAlerts !== 1 ? 's' : ''}` : '---'}
              </h3>
            </div>
            <div className="p-2 bg-amber-500/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-slate-400">
            {summary && summary.severeAlerts > 0 ? (
              <span className="text-rose-400">{summary.severeAlerts} severe — high probability conditions</span>
            ) : summary && summary.activeAlerts > 0 ? (
              <span className="text-amber-400">Moderate disruptions detected</span>
            ) : (
              <span className="text-emerald-400">Clear skies across monitored hubs</span>
            )}
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

      <h2 className="text-xl font-semibold text-slate-50 mt-8 mb-4 flex items-center">
        <Activity className="w-5 h-5 mr-2 text-amber-500" />
        Live Weather Disruptions
      </h2>

      {summary && summary.alerts.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {summary.alerts.map((alert) => (
            <div key={alert.id} className={`p-4 rounded-xl border ${alert.bg} ${alert.border} flex items-start space-x-4`}>
              <div className={`p-2 rounded-full bg-slate-950/50 ${alert.color}`}>
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className={`font-semibold ${alert.color}`}>{alert.hub} — {alert.reason}</h4>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    alert.severity === 'severe' ? 'bg-rose-500/20 text-rose-400' :
                    alert.severity === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {alert.severity}
                  </span>
                </div>
                <p className="text-slate-300 text-sm mt-1">{alert.impact}</p>
                <p className="text-slate-500 text-xs mt-2 font-mono">{alert.details}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-8 rounded-xl border border-slate-800 border-dashed bg-slate-900/30 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/40 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No active disruptions across monitored hubs</p>
          <p className="text-slate-500 text-sm mt-1">All 10 major hubs reporting normal operations</p>
        </div>
      )}

      <DataSourceBadge sources={['aviationweather.gov METAR', 'DOT BTS Denied Boarding Report']} />
    </div>
  );
}

function Scanner() {
  const [origin, setOrigin] = useState('ATL');
  const [dest, setDest] = useState('LGA');
  const [date, setDate] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<Flight[]>([]);
  const [searchMeta, setSearchMeta] = useState<FlightSearchMeta | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
  const [monitoredHubs, setMonitoredHubs] = useState<string[]>(['ATL', 'EWR', 'DFW', 'ORD']);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [originFAAStatus, setOriginFAAStatus] = useState<FAAStatus | null>(null);
  const [destFAAStatus, setDestFAAStatus] = useState<FAAStatus | null>(null);

  useEffect(() => {
    loadAlerts();
  }, [monitoredHubs]);

  const loadAlerts = async () => {
    setAlertsLoading(true);
    try {
      const data = await getWeatherAlerts(monitoredHubs);
      setAlerts(data.alerts);
    } catch {
      setAlerts([]);
    } finally {
      setAlertsLoading(false);
    }
  };

  const toggleHub = (hub: string) => {
    setMonitoredHubs(prev =>
      prev.includes(hub) ? prev.filter(h => h !== hub) : [...prev, hub]
    );
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    setResults([]);
    setSearchMeta(null);
    setSearchError(null);
    setOriginFAAStatus(null);
    setDestFAAStatus(null);
    setHeatmap([]);
    setHeatmapError(null);
    setHeatmapLoading(true);

    try {
      // Fetch flights and FAA status in parallel
      const [data, originFAA, destFAA, heatmapResult] = await Promise.all([
        searchFlights(origin, dest, date),
        getFAAStatus(origin).catch(() => null),
        getFAAStatus(dest).catch(() => null),
        getHeatmapSafe(origin, dest, 4),
      ]);
      setResults(data.flights);
      setSearchMeta(data.meta);
      setOriginFAAStatus(originFAA);
      setDestFAAStatus(destFAA);
      if (heatmapResult.ok) {
        setHeatmap(heatmapResult.data);
      } else {
        setHeatmapError(heatmapResult.error);
      }
    } catch (err: any) {
      setSearchError(err.message || 'Search failed');
      setHeatmapError('Unable to load heatmap');
    } finally {
      setIsSearching(false);
      setHeatmapLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Flight Scanner</h1>
        <p className="text-slate-400 mt-1">Real scheduled flights from FlightRadar24, scored for bump opportunity.</p>
      </header>

      {/* Live Network Disruptions */}
      <div className="mb-8 bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-50 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" />
            Live Weather Disruptions
          </h2>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500">via aviationweather.gov</span>
            <button onClick={loadAlerts} className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center transition-colors">
              <Bell className="w-4 h-4 mr-1" />
              Refresh
            </button>
          </div>
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

        {alertsLoading ? (
          <LoadingSpinner text="Checking live weather..." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {alerts.length > 0 ? (
              alerts.map(alert => (
                <div key={alert.id} className={`p-4 rounded-xl border ${alert.bg} ${alert.border} flex items-start space-x-4`}>
                  <div className={`p-2 rounded-full bg-slate-950/50 ${alert.color}`}>
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className={`font-semibold ${alert.color}`}>{alert.hub} — {alert.reason}</h4>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        alert.severity === 'severe' ? 'bg-rose-500/20 text-rose-400' :
                        alert.severity === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm mt-1">{alert.impact}</p>
                    <p className="text-slate-500 text-xs mt-2 font-mono">{alert.details}</p>
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
        )}
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
            {isSearching ? 'Scanning Live Data...' : 'Scan Flights'}
          </button>
        </div>
      </form>

      {(heatmapLoading || heatmap.length > 0 || heatmapError) && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-50 flex items-center">
              <Calendar className="w-4 h-4 mr-2 text-indigo-400" />
              Best Days to Fly (next 4 weeks)
            </h3>
            <span className="text-xs text-slate-500">Predictive heatmap</span>
          </div>

          {heatmapLoading ? (
            <LoadingSpinner text="Building heatmap..." />
          ) : heatmapError ? (
            <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300">
              {heatmapError}
            </div>
          ) : (
            <HeatmapGrid days={heatmap} />
          )}

          <DataSourceBadge sources={['DOT ATCR 2025', 'BTS quarterly trends', 'Holiday calendar']} />
        </div>
      )}

      {searchError && (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-400 flex items-start space-x-3">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-medium">Search Error</p>
            <p className="text-sm mt-1">{searchError}</p>
            <p className="text-xs text-rose-300/60 mt-1">Make sure the backend server is running (npm run dev starts both).</p>
          </div>
        </div>
      )}

      {/* FAA Delay Banner */}
      {(originFAAStatus || destFAAStatus) && (
        <FAADelayBanner originStatus={originFAAStatus} destStatus={destFAAStatus} />
      )}

      {/* Rate limit / no data banner */}
      {searchMeta && <RateLimitBanner meta={searchMeta} />}

      <AnimatePresence>
        {(results.length > 0 || (searchMeta && !searchError)) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {results.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-50">Target Opportunities</h3>
                  <div className="flex items-center space-x-3">
                    {searchMeta && searchMeta.verifiedFlights > 0 && (
                      <span className="text-xs text-emerald-400 flex items-center">
                        <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                        {searchMeta.verifiedFlights} verified
                      </span>
                    )}
                    <span className="text-sm text-slate-500">{results.length} flight{results.length !== 1 ? 's' : ''} found</span>
                  </div>
                </div>

                {results.map((flight) => (
                  <div key={flight.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
                          <Plane className="w-6 h-6 text-indigo-400" />
                        </div>
                        <div>
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="font-bold text-slate-50">{flight.flightNumber}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300" title={flight.aircraftFullName || flight.aircraft}>
                              {flight.aircraft}
                            </span>
                            {flight.registration && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800/50 text-slate-500 font-mono">{flight.registration}</span>
                            )}
                            {flight.isRegional && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Regional</span>
                            )}
                            {flight.lastFlightOfDay && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-semibold">🎰 Last Flight</span>
                            )}
                            <VerificationBadge flight={flight} />
                            <FlightStatusBadge status={flight.status} />
                          </div>
                          <div className="text-sm text-slate-400 mt-1 flex items-center flex-wrap gap-x-2">
                            <span>{flight.departure} {flight.depTime}</span>
                            <ChevronRight className="w-4 h-4" />
                            <span>{flight.arrival} {flight.arrTime}</span>
                            <span className="text-slate-600">|</span>
                            <span className="text-xs">{flight.capacity} seats</span>
                            {flight.trackingUrl && (
                              <>
                                <span className="text-slate-600">|</span>
                                <a
                                  href={flight.trackingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  FlightAware
                                </a>
                              </>
                            )}
                          </div>
                          {flight.codeshares && flight.codeshares.length > 0 && (
                            <div className="text-xs text-slate-500 mt-1">
                              Codeshares: {flight.codeshares.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col md:items-end">
                        <div className="flex items-center space-x-3">
                          <div className="text-right">
                            <p className="text-xs text-slate-400 uppercase tracking-wider">Bump Score</p>
                            <p className={`text-2xl font-bold ${getScoreTextColor(flight.bumpScore)}`}>
                              {flight.bumpScore}<span className="text-sm font-normal text-slate-500">/100</span>
                            </p>
                          </div>
                          <ScoreRing score={flight.bumpScore} size={56} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1 max-w-[200px] text-right">Relative opportunity index — not a probability</p>
                      </div>

                    </div>

                    {/* Factor pills (legacy text factors) */}
                    <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap gap-2">
                      {flight.factors.map((factor, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-md bg-slate-950 text-slate-400 border border-slate-800">
                          {factor}
                        </span>
                      ))}
                    </div>

                    {/* Score Breakdown Bars */}
                    {flight.factorsDetailed && flight.factorsDetailed.length > 0 && (
                      <ScoreBreakdown factors={flight.factorsDetailed} />
                    )}

                    {/* DOT Compensation Estimate */}
                    {flight.compensation && flight.compensation.tier !== 'none' && (
                      <div className={`mt-3 p-3 rounded-lg border ${flight.lastFlightOfDay ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                        <div className="flex items-start gap-2">
                          <span className="text-lg">💰</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${flight.lastFlightOfDay ? 'text-yellow-300' : 'text-emerald-300'}`}>
                              If bumped: {flight.compensation.compensationDisplay}
                              {flight.lastFlightOfDay && ' (next flight tomorrow, 400% rule)'}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {flight.compensation.explanation}
                            </p>
                            <p className="text-xs text-amber-400/80 mt-1 italic">
                              💡 Demand cash — DOT requires airlines to offer check/cash on request
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <DataSourceBadge sources={searchMeta?.dataSources} />

                {/* Scoring methodology note + data freshness warning */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-900/50 border border-slate-800/50">
                    <Info className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-slate-500">
                      <span className="text-slate-400 font-medium">Bump Score</span> is a relative opportunity index (0-100) based on BTS carrier statistics, aircraft type, timing, weather, and route demand. Higher = better chance of VDB opportunity. This is not a probability.
                    </p>
                  </div>
                  {searchMeta?.btsDataWarning && (
                    <p className="text-xs text-amber-500/70 px-1">{searchMeta.btsDataWarning}</p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoricalAnalysis() {
  const [carriers, setCarriers] = useState<CarrierStats[]>([]);
  const [trends, setTrends] = useState<QuarterlyTrend[]>([]);
  const [routes, setRoutes] = useState<OversoldRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'carriers' | 'trends' | 'routes'>('carriers');
  const [dataNote, setDataNote] = useState<string>('');

  useEffect(() => {
    Promise.all([
      getCarrierStats().then(d => { setCarriers(d.carriers); setDataNote(d.dataNote || ''); }),
      getQuarterlyTrends().then(d => setTrends(d.trends)),
      getTopRoutes().then(d => setRoutes(d.routes)),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingSpinner text="Loading BTS industry data..." />;

  return (
    <div className="space-y-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-50">Historical Analysis</h1>
        <p className="text-slate-400 mt-1">Real DOT Bureau of Transportation Statistics data on denied boardings.</p>
      </header>

      {/* Section Tabs */}
      <div className="flex space-x-2 bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
        {([
          { id: 'carriers', label: 'By Carrier', icon: <BarChart3 className="w-4 h-4 mr-1.5" /> },
          { id: 'trends', label: 'Quarterly Trends', icon: <TrendingUp className="w-4 h-4 mr-1.5" /> },
          { id: 'routes', label: 'Top Routes', icon: <MapPin className="w-4 h-4 mr-1.5" /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSection(tab.id)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center ${
              activeSection === tab.id
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Carrier Statistics */}
      {activeSection === 'carriers' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-slate-50 mb-6">Carrier Denied Boarding Rates</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-950/80 border-y border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Carrier</th>
                  <th className="px-4 py-3 font-medium text-center">VDB Rate</th>
                  <th className="px-4 py-3 font-medium text-center">IDB Rate</th>
                  <th className="px-4 py-3 font-medium text-center">Total DB</th>
                  <th className="px-4 py-3 font-medium text-center">Load Factor</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Compensation</th>
                  <th className="px-4 py-3 font-medium text-center">Oversale Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {carriers.map(c => (
                  <tr key={c.code} className="hover:bg-slate-800/30 transition-colors group">
                    <td className="px-4 py-4 font-medium text-slate-200">{c.name} ({c.code})</td>
                    <td className="px-4 py-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        c.vdbRate >= 0.8 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        c.vdbRate >= 0.4 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {c.vdbRate.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-300">{c.idbRate.toFixed(2)}</td>
                    <td className="px-4 py-4 text-center font-mono text-slate-300">{c.dbRate.toFixed(2)}</td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-16 bg-slate-800 rounded-full h-2">
                          <div
                            className="bg-indigo-500 h-2 rounded-full"
                            style={{ width: `${c.loadFactorPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-300">{c.loadFactorPct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-medium text-emerald-400" title={c.compensationNote || ''}>
                        {c.avgCompensationDisplay}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-300">{(c.oversaleRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-1">
            <p className="text-xs text-slate-500">Rates per 10,000 enplanements · Source: DOT Air Travel Consumer Report · Data: Jan–Sep 2025 (latest available)</p>
            {dataNote && <p className="text-xs text-slate-500">ℹ️ {dataNote}</p>}
            <p className="text-xs text-slate-500">💡 Compensation marked with ~ uses DOT-published industry averages. BTS COMP_PAID fields only track IDB cash, not VDB vouchers.</p>
          </div>
        </div>
      )}

      {/* Quarterly Trends */}
      {activeSection === 'trends' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-slate-50 mb-6">Quarterly Denied Boarding Trends</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-950/80 border-y border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Quarter</th>
                  <th className="px-4 py-3 font-medium text-right">Enplanements</th>
                  <th className="px-4 py-3 font-medium text-center">Voluntary DB</th>
                  <th className="px-4 py-3 font-medium text-center">Involuntary DB</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Compensation</th>
                  <th className="px-4 py-3 font-medium text-center">VDB per 10k</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {trends.map(t => {
                  const vdbPer10k = (t.voluntaryDB / t.totalEnplanements * 10000).toFixed(2);
                  return (
                    <tr key={t.quarter} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-4 font-medium text-slate-200">{t.quarter}</td>
                      <td className="px-4 py-4 text-right text-slate-300">{(t.totalEnplanements / 1_000_000).toFixed(0)}M</td>
                      <td className="px-4 py-4 text-center">
                        <span className="text-emerald-400 font-medium">{t.voluntaryDB.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="text-rose-400 font-medium">{t.involuntaryDB.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-4 text-right font-medium text-emerald-400">{t.avgCompensationDisplay}</td>
                      <td className="px-4 py-4 text-center font-mono text-slate-300">{vdbPer10k}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-1">
            <p className="text-xs text-slate-500">Source: DOT Bureau of Transportation Statistics · Latest available: Q3 2021</p>
            <p className="text-xs text-slate-500">💡 Compensation marked "N/A" = BTS COMP_PAID fields report $0 (tracks IDB cash only, not VDB vouchers).</p>
          </div>
        </div>
      )}

      {/* Top Oversold Routes */}
      {activeSection === 'routes' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-slate-50 mb-6">Top Oversold Routes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-400">
              <thead className="text-xs text-slate-500 uppercase bg-slate-950/80 border-y border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Route</th>
                  <th className="px-4 py-3 font-medium">Carrier</th>
                  <th className="px-4 py-3 font-medium text-center">Oversale Rate</th>
                  <th className="px-4 py-3 font-medium text-center">Avg Bumps/Flight</th>
                  <th className="px-4 py-3 font-medium text-right">Avg Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {routes.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-4">
                      <span className="font-medium text-slate-200">{r.origin}</span>
                      <ChevronRight className="w-3 h-3 inline mx-1 text-slate-600" />
                      <span className="font-medium text-slate-200">{r.destination}</span>
                    </td>
                    <td className="px-4 py-4 text-slate-300">{r.carrierName}</td>
                    <td className="px-4 py-4 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        r.avgOversaleRate >= 5 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        r.avgOversaleRate >= 4 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                        'bg-slate-800 text-slate-300'
                      }`}>
                        {r.avgOversaleRate}%
                      </span>
                    </td>
                    <td className="px-4 py-4 text-center font-mono text-slate-300">{r.avgBumps.toFixed(1)}</td>
                    <td className="px-4 py-4 text-right font-medium text-emerald-400">{r.avgCompensationDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-1">
            <p className="text-xs text-slate-500">Source: DOT Air Travel Consumer Report · Based on Jan–Sep 2025 data (latest available)</p>
            <p className="text-xs text-slate-500">💡 Compensation with ~ prefix uses DOT-published industry averages where BTS data reports $0.</p>
          </div>
        </div>
      )}

      <DataSourceBadge sources={['DOT BTS Air Travel Consumer Report', 'BTS T-100 Domestic Segment Data']} />
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
