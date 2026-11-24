import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Minus, Play, ShieldCheck } from 'lucide-react';
import type { FixVerificationRecord, IncidentRecord, UserRole, VerificationVerdict } from '../types';
import { formatShortTime } from './TelemetryCharts';

interface FixVerificationViewProps {
  fixes: FixVerificationRecord[];
  incidents: IncidentRecord[];
  userRole: UserRole;
  onVerifyFix: (fixId: string, outcome: 'recovery' | 'regression' | 'current') => Promise<void>;
  onOpenIncident: (incidentId: string) => void;
}

function verdictClasses(verdict: VerificationVerdict): string {
  switch (verdict) {
    case 'Improved':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'Became Worse':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'Stayed Similar':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

export const FixVerificationView: React.FC<FixVerificationViewProps> = ({
  fixes,
  incidents,
  userRole,
  onVerifyFix,
  onOpenIncident,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const canVerify =
    userRole === 'Developer' || userRole === 'Administrator' || userRole === 'Tester';

  async function handleRun(fixId: string, outcome: 'recovery' | 'regression' | 'current') {
    setBusyId(fixId);
    try {
      await onVerifyFix(fixId, outcome);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Post-Fix Behavior Comparison & Verification
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Compares pre-fix baseline indicators against post-fix telemetry to classify whether application health Improved, Stayed Similar, or Became Worse.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {fixes.length} fix record(s)
          </span>
        </div>
      </div>

      {fixes.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
          <p className="text-sm font-medium text-slate-900">No fixes recorded for verification yet.</p>
          <p className="text-xs text-slate-500 mt-1">
            Open an incident in Incident Details to record a mitigation and capture a pre-fix baseline.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {fixes.map((fix) => {
            const inc = incidents.find((i) => i.id === fix.incidentId);
            const pre = fix.preFixSnapshot;
            const post = fix.postFixSnapshot;
            const isBusy = busyId === fix.id;

            return (
              <div key={fix.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-500 font-mono">
                      {fix.id} · Incident {fix.incidentId} · Applied by {fix.appliedBy} at {formatShortTime(fix.appliedAt)} · Window {fix.verificationWindowSec}s
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-1">
                      {fix.fixSummary}
                    </div>
                    {inc && (
                      <button
                        type="button"
                        onClick={() => onOpenIncident(inc.id)}
                        className="text-xs text-blue-700 hover:underline mt-0.5"
                      >
                        {inc.title} ({inc.status})
                      </button>
                    )}
                  </div>

                  <span
                    className={`px-3 py-1 text-xs font-semibold rounded border inline-flex items-center gap-1.5 whitespace-nowrap ${verdictClasses(
                      fix.verdict
                    )}`}
                  >
                    {fix.verdict === 'Improved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {fix.verdict === 'Became Worse' && <ArrowUpRight className="w-3.5 h-3.5" />}
                    {fix.verdict === 'Stayed Similar' && <Minus className="w-3.5 h-3.5" />}
                    <span>Verdict: {fix.verdict}</span>
                  </span>
                </div>

                {/* Before vs After Metric Comparison Grid */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-5">Indicator</th>
                        <th className="py-2.5 px-5 text-right">Pre-Fix Baseline</th>
                        <th className="py-2.5 px-5 text-right">Post-Fix Measurement</th>
                        <th className="py-2.5 px-5 text-right">Change (Delta)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs font-mono tabular-nums">
                      <tr>
                        <td className="py-2.5 px-5 font-sans font-medium text-slate-900">
                          Failure-Risk Score
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-700">
                          {pre.riskScore} / 100 ({pre.riskLevel})
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-900 font-semibold">
                          {post ? `${post.riskScore} / 100 (${post.riskLevel})` : 'Awaiting verification'}
                        </td>
                        <td className="py-2.5 px-5 text-right">
                          {fix.deltas ? (
                            <span
                              className={
                                fix.deltas.riskScoreDelta < 0
                                  ? 'text-emerald-700 font-semibold inline-flex items-center gap-0.5'
                                  : fix.deltas.riskScoreDelta > 0
                                    ? 'text-red-700 font-semibold inline-flex items-center gap-0.5'
                                    : 'text-slate-600'
                              }
                            >
                              {fix.deltas.riskScoreDelta < 0 && <ArrowDownRight className="w-3.5 h-3.5" />}
                              {fix.deltas.riskScoreDelta > 0 && <ArrowUpRight className="w-3.5 h-3.5" />}
                              {fix.deltas.riskScoreDelta > 0 ? `+${fix.deltas.riskScoreDelta}` : fix.deltas.riskScoreDelta} pts
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-5 font-sans font-medium text-slate-900">
                          Error Rate (%)
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-700">
                          {pre.errorRatePct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-900 font-semibold">
                          {post ? `${post.errorRatePct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-5 text-right">
                          {fix.deltas
                            ? `${fix.deltas.errorRateDelta > 0 ? '+' : ''}${fix.deltas.errorRateDelta}%`
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-5 font-sans font-medium text-slate-900">
                          P95 Latency (ms)
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-700">
                          {Math.round(pre.latencyP95Ms)} ms
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-900 font-semibold">
                          {post ? `${Math.round(post.latencyP95Ms)} ms` : '—'}
                        </td>
                        <td className="py-2.5 px-5 text-right">
                          {fix.deltas
                            ? `${fix.deltas.latencyDelta > 0 ? '+' : ''}${fix.deltas.latencyDelta} ms`
                            : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2.5 px-5 font-sans font-medium text-slate-900">
                          Memory / CPU Utilization
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-700">
                          {pre.memoryPct.toFixed(0)}% / {pre.cpuPct.toFixed(0)}%
                        </td>
                        <td className="py-2.5 px-5 text-right text-slate-900 font-semibold">
                          {post ? `${post.memoryPct.toFixed(0)}% / ${post.cpuPct.toFixed(0)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-5 text-right">
                          {fix.deltas
                            ? `${fix.deltas.memoryDelta > 0 ? '+' : ''}${fix.deltas.memoryDelta}% mem`
                            : '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4">
                  <div className="text-xs text-slate-700 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-600 shrink-0" />
                    <span>{fix.verdictNotes}</span>
                  </div>

                  {canVerify && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRun(fix.id, 'current')}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Play className="w-3 h-3" />
                        <span>Verify Current Telemetry</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRun(fix.id, 'recovery')}
                        className="px-3 py-1.5 text-xs font-medium border border-emerald-300 bg-emerald-50 text-emerald-800 rounded hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        Simulate Healthy Recovery
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRun(fix.id, 'regression')}
                        className="px-3 py-1.5 text-xs font-medium border border-red-300 bg-red-50 text-red-800 rounded hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                      >
                        Simulate Regression
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
