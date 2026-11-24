import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Layers, ShieldAlert } from 'lucide-react';
import type {
  AlertRecord,
  ErrorCluster,
  FailurePrediction,
  IncidentRecord,
  MonitoredApp,
  RuntimeMetricPoint,
  UserRole,
} from '../types';
import { DualMetricChart, formatShortTime, riskColorClasses } from './TelemetryCharts';

interface HealthDashboardProps {
  activeApp: MonitoredApp | null;
  prediction: FailurePrediction | null;
  metrics: RuntimeMetricPoint[];
  clusters: ErrorCluster[];
  alerts: AlertRecord[];
  incidents: IncidentRecord[];
  totalLogCount: number;
  invalidLogCount: number;
  userRole: UserRole;
  onOpenIncident: (incidentId: string) => void;
  onConfirmCluster: (clusterId: string) => Promise<void>;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const HealthDashboard: React.FC<HealthDashboardProps> = ({
  activeApp,
  prediction,
  metrics,
  clusters,
  alerts,
  incidents,
  totalLogCount,
  invalidLogCount,
  userRole,
  onOpenIncident,
  onConfirmCluster,
  onAcknowledgeAlert,
  onNavigate,
}) => {
  if (!activeApp || !prediction) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
        <p className="text-sm font-medium text-slate-900">No monitored application selected.</p>
        <p className="text-xs text-slate-500 mt-1">
          Register or select an application to view health metrics and failure-risk predictions.
        </p>
      </div>
    );
  }

  const latestMetric = metrics[metrics.length - 1];
  const colors = riskColorClasses(prediction.riskLevel);
  const activeIncidents = incidents.filter((i) => i.status !== 'Resolved');
  const unackedAlerts = alerts.filter((a) => !a.acknowledged);
  const canModify = userRole === 'Developer' || userRole === 'Administrator';

  return (
    <div className="space-y-6">
      {/* Unacknowledged Alert Banner when risk crosses threshold */}
      {unackedAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-900">
                Pre-Failure Alert: {unackedAlerts[0].riskLevel} ({unackedAlerts[0].riskScore}/100) — {unackedAlerts[0].probableFailureType}
              </div>
              <div className="text-xs text-red-800 mt-0.5">
                {unackedAlerts[0].majorIndicators.join(' · ')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {unackedAlerts[0].incidentId && (
              <button
                type="button"
                onClick={() => onOpenIncident(unackedAlerts[0].incidentId!)}
                className="px-3 py-1.5 text-xs font-medium bg-red-700 text-white rounded-md hover:bg-red-800 whitespace-nowrap"
              >
                Investigate Incident
              </button>
            )}
            {(userRole === 'Developer' || userRole === 'Operations' || userRole === 'Administrator') && (
              <button
                type="button"
                onClick={() => onAcknowledgeAlert(unackedAlerts[0].id)}
                className="px-3 py-1.5 text-xs font-medium bg-white text-red-800 border border-red-300 rounded-md hover:bg-red-100 whitespace-nowrap"
              >
                Acknowledge
              </button>
            )}
          </div>
        </div>
      )}

      {/* Primary Prediction Focal Anchor + 4-Metric KPI Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5">
            <div className="text-xs text-slate-500">
              {activeApp.name} · {activeApp.environment} · Updated {formatShortTime(prediction.calculatedAt)}
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="text-4xl font-bold tracking-tight text-slate-900 tabular-nums font-mono">
                {prediction.riskScore}
              </span>
              <span className="text-sm text-slate-500 font-mono">/ 100 Risk Score</span>
              <span
                className={`px-2.5 py-0.5 text-xs font-semibold rounded border ${colors.bg} ${colors.text} ${colors.border}`}
              >
                {prediction.riskLevel}
              </span>
            </div>

            {/* Progress bar with alert threshold marker */}
            <div className="mt-4 relative">
              <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${colors.bar}`}
                  style={{ width: `${prediction.riskScore}%` }}
                />
              </div>
              <div
                className="absolute -top-1 w-0.5 h-4 bg-slate-900"
                style={{ left: `${activeApp.thresholds.alertTriggerScore}%` }}
                title={`Alert threshold: ${activeApp.thresholds.alertTriggerScore}`}
              />
              <div className="flex justify-between text-[11px] text-slate-500 font-mono mt-1.5 tabular-nums">
                <span>0 Normal</span>
                <span>Alert Threshold: {activeApp.thresholds.alertTriggerScore}</span>
                <span>100 Critical</span>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-700">
              <span className="font-semibold">Probable Failure Pattern:</span> {prediction.probableFailureType}
              {prediction.anomalyDetected && (
                <span className="ml-2 text-red-700 font-mono">
                  (Anomaly Z={prediction.anomalyZScore.toFixed(2)}σ)
                </span>
              )}
            </div>

            <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2.5">
              <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
              <span>{prediction.disclaimer}</span>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t lg:border-t-0 lg:border-l border-slate-200 pt-5 lg:pt-0 lg:pl-6">
            <div>
              <div className="text-xs text-slate-500">Error Rate</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
                {(latestMetric?.errorRatePct ?? 0).toFixed(2)}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                Limit {activeApp.thresholds.maxErrorRatePct}%
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">P95 Latency</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
                {Math.round(latestMetric?.latencyP95Ms ?? 0)} ms
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                Limit {activeApp.thresholds.maxLatencyMs} ms
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Memory / DB Pool</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
                {Math.round(latestMetric?.memoryPct ?? 0)}% / {Math.round(latestMetric?.dbPoolPct ?? 0)}%
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                CPU {Math.round(latestMetric?.cpuPct ?? 0)}%
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Open Incidents</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums font-mono">
                {activeIncidents.length}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                {totalLogCount} valid · {invalidLogCount} invalid logs
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Telemetry Time-Series Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DualMetricChart
          metrics={metrics}
          title="Error Rate & P95 Response Latency"
          subtitle="Tracks rising failure rates and latency spikes prior to service crash"
          primaryLabel="Error Rate"
          secondaryLabel="P95 Latency"
          getPrimary={(m) => m.errorRatePct}
          getSecondary={(m) => m.latencyP95Ms}
          primaryUnit="%"
          secondaryUnit=" ms"
          primaryColor="#dc2626"
          secondaryColor="#1d4ed8"
        />

        <DualMetricChart
          metrics={metrics}
          title="Memory Utilization & DB Pool Saturation"
          subtitle="Resource pressure indicators contributing to predictive failure risk"
          primaryLabel="DB Pool"
          secondaryLabel="Memory"
          getPrimary={(m) => m.dbPoolPct}
          getSecondary={(m) => m.memoryPct}
          primaryUnit="%"
          secondaryUnit="%"
          primaryColor="#d97706"
          secondaryColor="#0f172a"
        />
      </div>

      {/* Contributing Risk Factors (SFA-FR-015) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Main Indicators Contributing to Failure-Risk Prediction
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Explainable weight breakdown showing how current telemetry compares against baseline limits.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('logs')}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            Run Failure Scenario
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Indicator</th>
                <th className="py-2.5 px-4">Current Value</th>
                <th className="py-2.5 px-4">Baseline / Threshold</th>
                <th className="py-2.5 px-4 text-right">Risk Points</th>
                <th className="py-2.5 px-4">State</th>
                <th className="py-2.5 px-4">Diagnostic Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {prediction.contributingFactors.map((factor) => {
                const fc = riskColorClasses(factor.status);
                return (
                  <tr key={factor.indicator} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-900">{factor.indicator}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-900">
                      {factor.currentValue}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                      {factor.baselineValue}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      +{factor.contributionPoints}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border ${fc.bg} ${fc.text} ${fc.border}`}
                      >
                        {factor.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{factor.explanation}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Grouped Error Clusters & Affected Components (SFA-FR-005..010) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Error Clusters & Affected Components
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Similar errors normalized and grouped automatically with probable vs confirmed root cause.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {clusters.length} cluster(s)
          </span>
        </div>

        {clusters.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No recurring error clusters detected for {activeApp.name}.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {clusters.map((cluster) => (
              <div key={cluster.id} className="p-5 hover:bg-slate-50/60 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-1">
                      <span className="font-semibold text-slate-800">{cluster.component}</span>
                      <span>·</span>
                      <span>{cluster.failureCategory}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{cluster.count} event(s)</span>
                      <span>·</span>
                      <span className="font-mono">Last seen {formatShortTime(cluster.lastSeen)}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-900 font-mono break-all">
                      {cluster.signature}
                    </div>
                    <p className="mt-2 text-xs text-slate-700">
                      <span className="font-semibold">
                        {cluster.causeStatus === 'Confirmed' ? 'Confirmed Cause:' : 'Probable Cause:'}
                      </span>{' '}
                      {cluster.confirmedCause ?? cluster.probableCause}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 text-[11px] font-medium rounded border ${
                        cluster.causeStatus === 'Confirmed'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {cluster.causeStatus === 'Confirmed' ? (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Confirmed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Probable
                        </span>
                      )}
                    </span>

                    {canModify && cluster.causeStatus === 'Probable' && (
                      <button
                        type="button"
                        onClick={() => onConfirmCluster(cluster.id)}
                        className="px-2.5 py-1 text-xs font-medium border border-slate-300 bg-white text-slate-800 rounded hover:bg-slate-100 whitespace-nowrap"
                      >
                        Confirm Cause
                      </button>
                    )}

                    {incidents.find((i) => i.clusterId === cluster.id) && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenIncident(incidents.find((i) => i.clusterId === cluster.id)!.id)
                        }
                        className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 whitespace-nowrap inline-flex items-center gap-1"
                      >
                        <Layers className="w-3 h-3" /> Inspect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
