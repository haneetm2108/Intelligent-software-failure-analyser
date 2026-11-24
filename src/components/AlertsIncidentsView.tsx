import React, { useMemo, useState } from 'react';
import { Bell, Check, Search } from 'lucide-react';
import type { AlertRecord, IncidentRecord, IncidentStatus, MonitoredApp, UserRole } from '../types';
import { formatShortTime, riskColorClasses } from './TelemetryCharts';

interface AlertsIncidentsViewProps {
  apps: MonitoredApp[];
  alerts: AlertRecord[];
  incidents: IncidentRecord[];
  userRole: UserRole;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onUpdateIncidentStatus: (incidentId: string, status: IncidentStatus) => Promise<void>;
  onSelectIncident: (incidentId: string) => void;
}

const STATUS_OPTIONS: IncidentStatus[] = ['Open', 'Investigating', 'Mitigated', 'Resolved'];

function statusBadgeClasses(status: IncidentStatus): string {
  switch (status) {
    case 'Resolved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Mitigated':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'Investigating':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-red-50 text-red-700 border-red-200';
  }
}

export const AlertsIncidentsView: React.FC<AlertsIncidentsViewProps> = ({
  apps,
  alerts,
  incidents,
  userRole,
  onAcknowledgeAlert,
  onUpdateIncidentStatus,
  onSelectIncident,
}) => {
  const [appFilter, setAppFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const canManageIncidents =
    userRole === 'Developer' || userRole === 'Operations' || userRole === 'Administrator';

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (appFilter !== 'all' && inc.appId !== appFilter) return false;
      if (statusFilter !== 'all' && inc.status !== statusFilter) return false;
      if (severityFilter !== 'all' && inc.severity !== severityFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${inc.id} ${inc.title} ${inc.component} ${inc.failureCategory} ${inc.probableCause}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [incidents, appFilter, statusFilter, severityFilter, search]);

  return (
    <div className="space-y-6">
      {/* Alert Panel (SFA-FR-018..020) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-700" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Pre-Failure & Threshold Alerts</h2>
              <p className="text-xs text-slate-500">
                Generated automatically when an application reaches its configured failure-risk threshold.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-slate-600 tabular-nums">
            {alerts.filter((a) => !a.acknowledged).length} unacknowledged
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No alerts recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {alerts.map((alert) => {
              const rc = riskColorClasses(alert.riskLevel);
              return (
                <div
                  key={alert.id}
                  className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">{alert.id}</span>
                      <span>·</span>
                      <span className="font-medium text-slate-900">{alert.appName}</span>
                      <span>·</span>
                      <span className="font-mono">{formatShortTime(alert.timestamp)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${rc.bg} ${rc.text} ${rc.border}`}>
                        {alert.riskLevel} ({alert.riskScore}/100)
                      </span>
                      <span className="text-sm font-medium text-slate-900">
                        {alert.probableFailureType}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Indicators: {alert.majorIndicators.join(' · ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {alert.incidentId && (
                      <button
                        type="button"
                        onClick={() => onSelectIncident(alert.incidentId!)}
                        className="px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        Open {alert.incidentId}
                      </button>
                    )}

                    {alert.acknowledged ? (
                      <span className="text-xs text-emerald-700 font-medium inline-flex items-center gap-1 whitespace-nowrap">
                        <Check className="w-3.5 h-3.5" />
                        Ack by {alert.acknowledgedBy}
                      </span>
                    ) : canManageIncidents ? (
                      <button
                        type="button"
                        onClick={() => onAcknowledgeAlert(alert.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 whitespace-nowrap"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">Read-only role</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Incident History & Tracking Table (SFA-FR-021, SFA-FR-022, SFA-FR-029) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Incident Tracking & History</h2>
            <p className="text-xs text-slate-500">
              Filter by application, severity, or status and open any incident for RCA and fix verification.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                placeholder="Search incidents..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
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
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Incident ID</th>
                <th className="py-2.5 px-4">Application & Component</th>
                <th className="py-2.5 px-4">Failure Summary</th>
                <th className="py-2.5 px-4">Risk</th>
                <th className="py-2.5 px-4">Cause</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredIncidents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No incidents match the active filters.
                  </td>
                </tr>
              ) : (
                filteredIncidents.map((inc) => {
                  const rc = riskColorClasses(inc.riskLevel);
                  return (
                    <tr key={inc.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {inc.id}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{inc.appName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{inc.component}</div>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-medium text-slate-900 truncate">{inc.failureCategory}</div>
                        <div className="text-[11px] text-slate-500">
                          Updated {formatShortTime(inc.updatedAt)}
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border font-mono tabular-nums ${rc.bg} ${rc.text} ${rc.border}`}>
                          {inc.riskScore} · {inc.riskLevel}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="text-slate-700 font-medium">{inc.causeStatus}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {canManageIncidents ? (
                          <select
                            value={inc.status}
                            onChange={(e) =>
                              onUpdateIncidentStatus(inc.id, e.target.value as IncidentStatus)
                            }
                            className={`px-2 py-1 text-[11px] font-semibold rounded border ${statusBadgeClasses(inc.status)}`}
                          >
                            {STATUS_OPTIONS.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${statusBadgeClasses(inc.status)}`}>
                            {inc.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectIncident(inc.id)}
                          className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 whitespace-nowrap"
                        >
                          Details & RCA
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
