import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Play, Search, Upload, Zap } from 'lucide-react';
import { api } from '../api';
import type { IngestionResponse, InvalidLogEntry, LogEntry, MonitoredApp, UserRole } from '../types';
import { formatShortTime } from './TelemetryCharts';

interface LogsScenariosViewProps {
  activeApp: MonitoredApp | null;
  apps: MonitoredApp[];
  userRole: UserRole;
  onDataUpdated: () => Promise<void>;
}

const SCENARIO_LIST: Array<{
  id:
    | 'db-pool-exhaustion'
    | 'memory-leak-oom'
    | 'http-5xx-cascade'
    | 'benchmark-10k'
    | 'post-fix-recovery';
  title: string;
  summary: string;
}> = [
  {
    id: 'db-pool-exhaustion',
    title: 'DB Connection Pool Exhaustion',
    summary: 'Injects checkout timeout stack traces, masked DB credentials, 1 malformed line, and 99% pool saturation.',
  },
  {
    id: 'memory-leak-oom',
    title: 'Memory Leak & Heap Exhaustion',
    summary: 'Simulates heap growth to 96%, GC stalls, and OutOfMemoryError crash traces.',
  },
  {
    id: 'http-5xx-cascade',
    title: 'HTTP 5xx Upstream Cascade',
    summary: 'Triggers 502/503/504 gateway timeouts and elevated error rates across api-gateway.',
  },
  {
    id: 'benchmark-10k',
    title: '10,000-Log Stress Benchmark (SFA-NFR-001)',
    summary: 'Processes 10,000 mixed JSON/text logs (with 150 invalid lines + embedded JWTs) and measures ingestion time.',
  },
  {
    id: 'post-fix-recovery',
    title: 'Healthy Post-Fix Telemetry',
    summary: 'Sends healthy 200 OK logs and nominal metrics to validate recovery.',
  },
];

function severityClasses(sev: string): string {
  switch (sev) {
    case 'FATAL':
    case 'ERROR':
      return 'text-red-700 bg-red-50 border-red-200';
    case 'WARN':
      return 'text-amber-700 bg-amber-50 border-amber-200';
    default:
      return 'text-slate-700 bg-slate-100 border-slate-200';
  }
}

export const LogsScenariosView: React.FC<LogsScenariosViewProps> = ({
  activeApp,
  apps,
  userRole,
  onDataUpdated,
}) => {
  const [appFilter, setAppFilter] = useState<string>(activeApp?.id ?? 'all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [componentFilter, setComponentFilter] = useState<string>('all');
  const [rangeMinutes, setRangeMinutes] = useState<number>(0);
  const [search, setSearch] = useState('');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [invalidLogs, setInvalidLogs] = useState<InvalidLogEntry[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [rawLogsInput, setRawLogsInput] = useState(
    '2026-11-15T19:18:00Z [ERROR] [db-pool] Connection timeout acquiring DB handle with api_key=sk-demoSecret987654321\n  at Pool.acquire (src/db/pool.ts:118:15)\nINVALID_UNSTRUCTURED_CORRUPT_LINE'
  );
  const [ingesting, setIngesting] = useState(false);
  const [lastResult, setLastResult] = useState<IngestionResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canIngest =
    userRole === 'Developer' || userRole === 'Administrator' || userRole === 'Tester';

  useEffect(() => {
    if (activeApp) {
      setAppFilter(activeApp.id);
    }
  }, [activeApp]);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await api.getLogs({
        appId: appFilter,
        severity: severityFilter,
        component: componentFilter,
        rangeMinutes,
        search,
        limit: 120,
      });
      setLogs(res.logs);
      setInvalidLogs(res.invalidLogs);
      setTotalMatched(res.totalMatched);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoadingLogs(false);
    }
  }, [appFilter, severityFilter, componentFilter, rangeMinutes, search]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  async function handleIngestSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetId = appFilter !== 'all' ? appFilter : activeApp?.id ?? apps[0]?.id;
    if (!targetId) return;
    setErrorMsg(null);
    setIngesting(true);
    try {
      const res = await api.ingestLogs({
        appId: targetId,
        rawLogs: rawLogsInput,
        source: 'ui-log-uploader',
      });
      setLastResult(res);
      await Promise.all([fetchLogs(), onDataUpdated()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Ingestion failed');
    } finally {
      setIngesting(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawLogsInput(text);
  }

  async function handleRunScenario(
    scenarioId:
      | 'db-pool-exhaustion'
      | 'memory-leak-oom'
      | 'http-5xx-cascade'
      | 'benchmark-10k'
      | 'post-fix-recovery'
  ) {
    const targetId = appFilter !== 'all' ? appFilter : activeApp?.id ?? apps[0]?.id;
    if (!targetId) return;
    setErrorMsg(null);
    setIngesting(true);
    try {
      const res = await api.runScenario({ appId: targetId, scenarioId });
      setLastResult(res);
      await Promise.all([fetchLogs(), onDataUpdated()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Scenario execution failed');
    } finally {
      setIngesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Ingestion Result Summary */}
      {lastResult && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-900">
              {lastResult.scenarioName ? `Scenario Completed: ${lastResult.scenarioName}` : 'Log Batch Processed'}
            </div>
            <div className="text-xs text-slate-600 mt-0.5 font-mono tabular-nums">
              Total lines: {lastResult.totalLines} · Valid: {lastResult.validCount} · Invalid reported: {lastResult.invalidCount} · Secrets masked: {lastResult.secretsMaskedCount} · Duration: {lastResult.processingMs} ms
            </div>
          </div>
          <div className="text-xs font-mono font-semibold text-slate-900">
            Updated Risk Score: {lastResult.prediction.riskScore}/100 ({lastResult.prediction.riskLevel})
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Controlled Failure Scenarios & Upload Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Controlled Failure Scenarios & Performance Benchmark
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Simulate failure conditions or run the 10,000-record performance test against the selected application.
          </p>

          <div className="mt-4 space-y-2.5">
            {SCENARIO_LIST.map((sc) => (
              <div
                key={sc.id}
                className="flex items-center justify-between gap-3 border border-slate-200 rounded-md p-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">{sc.title}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{sc.summary}</div>
                </div>
                <button
                  type="button"
                  disabled={!canIngest || ingesting}
                  onClick={() => handleRunScenario(sc.id)}
                  className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3 h-3" />
                  <span>Run</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Upload or Paste Application Logs & Stack Traces
                </h2>
              </div>
              <label className="text-xs font-medium text-blue-700 hover:underline cursor-pointer whitespace-nowrap">
                Load .log / .json File
                <input
                  type="file"
                  accept=".log,.txt,.json,.jsonl"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Supports JSON lines, ISO-prefixed logs, and multi-line stack traces. Secrets are masked automatically before storage.
            </p>

            <form onSubmit={handleIngestSubmit} className="mt-4 space-y-3">
              <textarea
                rows={9}
                value={rawLogsInput}
                onChange={(e) => setRawLogsInput(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                placeholder="Paste JSON logs, structured logs, or stack traces..."
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500">
                  Target: {apps.find((a) => a.id === (appFilter !== 'all' ? appFilter : activeApp?.id))?.name ?? 'Default App'}
                </span>
                <button
                  type="submit"
                  disabled={!canIngest || ingesting}
                  className="px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
                >
                  {ingesting ? 'Processing Batch...' : 'Ingest & Analyze Logs'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Searchable Log Viewer (SFA-FR-029 & SFA-NFR-011) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Searchable Log Explorer</h2>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Showing {logs.length} of {totalMatched} matching valid log(s)
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search message, stack, component..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md w-56 focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="all">All Applications</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="all">All Severities</option>
              <option value="FATAL">FATAL</option>
              <option value="ERROR">ERROR</option>
              <option value="WARN">WARN</option>
              <option value="INFO">INFO</option>
            </select>

            <select
              value={componentFilter}
              onChange={(e) => setComponentFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="all">All Components</option>
              <option value="db-pool">db-pool</option>
              <option value="api-gateway">api-gateway</option>
              <option value="auth-service">auth-service</option>
              <option value="payment-gateway">payment-gateway</option>
              <option value="worker-runtime">worker-runtime</option>
              <option value="cache-layer">cache-layer</option>
            </select>

            <select
              value={rangeMinutes}
              onChange={(e) => setRangeMinutes(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value={0}>All Time</option>
              <option value={15}>Last 15 min</option>
              <option value={60}>Last 1 hour</option>
              <option value={1440}>Last 24 hours</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Severity</th>
                <th className="py-2.5 px-4">Component</th>
                <th className="py-2.5 px-4">Sanitized Message & Stack Trace</th>
                <th className="py-2.5 px-4 text-right">Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {loadingLogs ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    Loading logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No valid log records match the current filters.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 align-top">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatShortTime(log.timestamp)}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 text-[11px] font-mono font-semibold rounded border ${severityClasses(
                          log.severity
                        )}`}
                      >
                        {log.severity}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-800 whitespace-nowrap">
                      {log.component}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-900 break-all">
                      <div>{log.message}</div>
                      {log.stackTrace && (
                        <pre className="mt-1.5 text-[11px] text-slate-600 bg-slate-100 p-2 rounded overflow-x-auto">
                          {log.stackTrace}
                        </pre>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {log.latencyMs !== undefined ? `${log.latencyMs} ms` : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invalid Log Diagnostics (SFA-FR-004) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Invalid / Rejected Log Entries (Non-Blocking Parser Diagnostics)
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {invalidLogs.length} recorded
          </span>
        </div>

        {invalidLogs.length === 0 ? (
          <div className="p-6 text-xs text-slate-500 text-center">
            No invalid log records detected.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 text-xs">
            {invalidLogs.slice(0, 10).map((inv, idx) => (
              <div key={idx} className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-slate-800">
                  Line {inv.lineNumber}: <span className="text-red-700">{inv.rawSnippet}</span>
                </div>
                <div className="text-slate-500">{inv.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
