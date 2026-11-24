import React, { useState } from 'react';
import { CheckCircle2, FileText, Printer, ShieldAlert, Sparkles, Wrench } from 'lucide-react';
import { api } from '../api';
import type {
  ErrorCluster,
  FixVerificationRecord,
  IncidentRecord,
  IncidentStatus,
  PlainLanguageExplanation,
  UserRole,
} from '../types';
import { formatShortTime, riskColorClasses } from './TelemetryCharts';

interface IncidentDetailsViewProps {
  incidents: IncidentRecord[];
  selectedIncidentId: string | null;
  clusters: ErrorCluster[];
  fixes: FixVerificationRecord[];
  userRole: UserRole;
  onSelectIncident: (id: string) => void;
  onUpdateIncident: (id: string, payload: { status?: IncidentStatus; confirmedCause?: string }) => Promise<void>;
  onRecordFix: (
    incidentId: string,
    payload: { fixSummary: string; selectedRecommendation?: string; verificationWindowSec: number }
  ) => Promise<void>;
  onOpenVerification: () => void;
}

export const IncidentDetailsView: React.FC<IncidentDetailsViewProps> = ({
  incidents,
  selectedIncidentId,
  clusters,
  fixes,
  userRole,
  onSelectIncident,
  onUpdateIncident,
  onRecordFix,
  onOpenVerification,
}) => {
  const incident =
    incidents.find((i) => i.id === selectedIncidentId) ?? incidents[0] ?? null;

  const [confirmedDraft, setConfirmedDraft] = useState('');
  const [fixSummary, setFixSummary] = useState('');
  const [selectedRec, setSelectedRec] = useState('');
  const [windowSec, setWindowSec] = useState(60);
  const [submittingFix, setSubmittingFix] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplanation, setAiExplanation] = useState<PlainLanguageExplanation | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  if (!incident) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
        <p className="text-sm font-medium text-slate-900">No incidents available to inspect.</p>
        <p className="text-xs text-slate-500 mt-1">
          Run a failure scenario or ingest error logs to generate an incident with root-cause analysis.
        </p>
      </div>
    );
  }

  const linkedCluster =
    clusters.find((c) => c.id === incident.clusterId) ??
    clusters.find((c) => c.appId === incident.appId && c.component === incident.component);
  const linkedFix = fixes.find((f) => f.incidentId === incident.id);
  const rc = riskColorClasses(incident.riskLevel);
  const canEdit = userRole === 'Developer' || userRole === 'Administrator';

  async function handleConfirmCause(e: React.FormEvent) {
    e.preventDefault();
    if (!incident) return;
    const causeText = confirmedDraft.trim() || incident.probableCause;
    await onUpdateIncident(incident.id, { confirmedCause: causeText });
    setConfirmedDraft('');
    setActionMessage('Root cause marked as Confirmed.');
  }

  async function handleExplainWithAI() {
    if (!incident) return;
    setAiLoading(true);
    try {
      const res = await api.explainIncident(incident.id);
      setAiExplanation(res);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'AI explanation failed.');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleSubmitFix(e: React.FormEvent) {
    e.preventDefault();
    if (!incident || !fixSummary.trim()) return;
    setSubmittingFix(true);
    try {
      await onRecordFix(incident.id, {
        fixSummary: fixSummary.trim(),
        selectedRecommendation: selectedRec || undefined,
        verificationWindowSec: windowSec,
      });
      setFixSummary('');
      setActionMessage('Fix recorded and pre-fix baseline captured. Switch to Fix Verification to evaluate post-fix behavior.');
    } finally {
      setSubmittingFix(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Incident Switcher & Report Toggle */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-3">
          <label htmlFor="incident-selector" className="text-xs font-semibold text-slate-700">
            Selected Incident:
          </label>
          <select
            id="incident-selector"
            value={incident.id}
            onChange={(e) => {
              setAiExplanation(null);
              setActionMessage(null);
              onSelectIncident(e.target.value);
            }}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white font-medium text-slate-900"
          >
            {incidents.map((inc) => (
              <option key={inc.id} value={inc.id}>
                {inc.id} — {inc.appName} ({inc.status})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReport(!showReport)}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{showReport ? 'Hide Incident Report' : 'Generate Incident Report'}</span>
          </button>
          {showReport && (
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Report</span>
            </button>
          )}
        </div>
      </div>

      {actionMessage && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-xs text-emerald-800 flex items-center justify-between">
          <span>{actionMessage}</span>
          {linkedFix && (
            <button
              type="button"
              onClick={onOpenVerification}
              className="font-semibold underline hover:text-emerald-950 whitespace-nowrap ml-4"
            >
              Go to Fix Verification
            </button>
          )}
        </div>
      )}

      {/* Printable Incident Report Card (SFA-FR-030) */}
      {showReport && (
        <div className="bg-white border border-slate-300 rounded-lg p-6 space-y-4">
          <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Incident Summary Report — {incident.id}
              </h2>
              <p className="text-xs text-slate-500">
                {incident.appName} · Component: {incident.component} · Generated {new Date().toLocaleString()}
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-slate-700">
              Status: {incident.status}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-900">1. Problem Statement</div>
              <p className="text-slate-700 mt-1">{incident.title}</p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">
                2. Root Cause ({incident.causeStatus})
              </div>
              <p className="text-slate-700 mt-1">
                {incident.confirmedCause ?? incident.probableCause}
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900">3. Supporting Evidence</div>
              <ul className="list-disc pl-4 mt-1 text-slate-700 space-y-1">
                {incident.evidence.map((ev, i) => (
                  <li key={i}>{ev}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900">4. Recommendations & Verification</div>
              <ul className="list-disc pl-4 mt-1 text-slate-700 space-y-1">
                {incident.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
              <div className="mt-2 font-medium text-slate-900">
                Verification Result:{' '}
                {linkedFix ? `${linkedFix.verdict} — ${linkedFix.verdictNotes}` : 'Pending fix submission'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Incident Header & Root-Cause Status */}
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500 font-mono">
              {incident.id} · {incident.appName} · Component: {incident.component} · Created {formatShortTime(incident.createdAt)}
            </div>
            <h2 className="text-lg font-bold text-slate-900 mt-1">{incident.title}</h2>
          </div>

          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 text-xs font-semibold rounded border font-mono ${rc.bg} ${rc.text} ${rc.border}`}>
              Risk {incident.riskScore}/100 ({incident.riskLevel})
            </span>
            <span className="px-2.5 py-1 text-xs font-semibold rounded border border-slate-200 bg-slate-100 text-slate-800">
              {incident.status}
            </span>
          </div>
        </div>

        {/* Probable vs Confirmed Root Cause (SFA-FR-010) */}
        <div className="mt-6 pt-5 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Root-Cause Analysis</h3>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${
                  incident.causeStatus === 'Confirmed'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {incident.causeStatus === 'Confirmed'
                  ? 'Confirmed Cause (Human Verified)'
                  : 'Probable Cause (System Inferred)'}
              </span>
            </div>

            <p className="text-sm text-slate-800 leading-relaxed bg-slate-50 border border-slate-200 rounded-md p-4">
              {incident.confirmedCause ?? incident.probableCause}
            </p>

            {canEdit && (
              <form onSubmit={handleConfirmCause} className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={confirmedDraft}
                  onChange={(e) => setConfirmedDraft(e.target.value)}
                  placeholder="Optional: refine confirmed root cause description..."
                  className="flex-1 min-w-[220px] px-3 py-1.5 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {incident.causeStatus === 'Confirmed' ? 'Update Confirmed Cause' : 'Confirm Root Cause'}
                  </span>
                </button>
              </form>
            )}

            {/* Supporting Evidence (SFA-FR-009, SFA-NFR-011 masked) */}
            <div className="pt-2">
              <h4 className="text-xs font-semibold text-slate-700 mb-2">
                Supporting Log & Metric Evidence (Secrets Masked)
              </h4>
              <ul className="space-y-2">
                {incident.evidence.map((ev, idx) => (
                  <li
                    key={idx}
                    className="text-xs font-mono text-slate-800 bg-slate-50 border border-slate-200 rounded px-3 py-2 break-all"
                  >
                    {ev}
                  </li>
                ))}
              </ul>
            </div>

            {linkedCluster?.sampleStackTrace && (
              <div>
                <h4 className="text-xs font-semibold text-slate-700 mb-2">Captured Stack Trace</h4>
                <pre className="text-[11px] font-mono text-slate-100 bg-slate-900 rounded-md p-3.5 overflow-x-auto leading-relaxed">
                  {linkedCluster.sampleStackTrace}
                </pre>
              </div>
            )}
          </div>

          {/* Right Column: Recommendations + Gemini Optional Explainer + Record Fix */}
          <div className="lg:col-span-5 space-y-5">
            <div className="border border-slate-200 rounded-md p-4">
              <h3 className="text-sm font-semibold text-slate-900">
                Suggested Corrective Actions
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Safety rule: suggested fixes require developer review and are never auto-executed.
              </p>
              <ul className="mt-3 space-y-2">
                {incident.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="selected-rec"
                      checked={selectedRec === rec}
                      onChange={() => {
                        setSelectedRec(rec);
                        if (!fixSummary) setFixSummary(rec);
                      }}
                      className="mt-0.5"
                    />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Optional LLM Plain-Language Explanation (SFA-NFR-008 & SFA-NFR-015) */}
            <div className="border border-slate-200 rounded-md p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Plain-Language Evidence Explanation
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Optional AI summary using sanitized evidence only.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExplainWithAI}
                  disabled={aiLoading}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{aiLoading ? 'Analyzing...' : 'Explain Evidence'}</span>
                </button>
              </div>

              {aiExplanation && (
                <div className="mt-3 pt-3 border-t border-slate-200 space-y-2 text-xs">
                  <div className="text-[11px] font-mono text-slate-500">
                    Model: {aiExplanation.model}
                  </div>
                  <p className="text-slate-800 font-medium">{aiExplanation.plainSummary}</p>
                  <p className="text-slate-600">{aiExplanation.whyItHappens}</p>
                  {aiExplanation.errorMessage && (
                    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      {aiExplanation.errorMessage}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Record Fix & Begin Post-Fix Verification (SFA-FR-024..025) */}
            <div className="border border-slate-200 rounded-md p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Wrench className="w-4 h-4 text-slate-700" />
                <span>Record Applied Fix & Verify</span>
              </div>

              {canEdit ? (
                <form onSubmit={handleSubmitFix} className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mitigation / Fix Description
                    </label>
                    <textarea
                      rows={3}
                      value={fixSummary}
                      onChange={(e) => setFixSummary(e.target.value)}
                      placeholder="Describe the fix applied (e.g. Increased DB pool max to 80 and added query timeout)..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Post-Fix Verification Window (seconds)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={3600}
                      value={windowSec}
                      onChange={(e) => setWindowSec(Number(e.target.value))}
                      className="w-32 px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={submittingFix}
                    className="w-full py-2 px-4 bg-slate-900 text-white text-xs font-medium rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                  >
                    {submittingFix ? 'Recording Fix...' : 'Record Fix & Capture Pre-Fix Baseline'}
                  </button>
                </form>
              ) : (
                <div className="mt-3 flex items-start gap-2 text-xs text-slate-500">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Only Developer or Administrator roles can record mitigation fixes.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
