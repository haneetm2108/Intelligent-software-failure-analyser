import React from 'react';
import { BookOpen } from 'lucide-react';

export const DocumentationView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-slate-700" />
          <h2 className="text-base font-bold text-slate-900">
            System Guide, Risk-Score Methodology & REST API Reference
          </h2>
        </div>
        <p className="text-xs text-slate-600 mt-1">
          Reference documentation covering how failure-risk scores are computed, how to test controlled scenarios, and implemented SRS requirements.
        </p>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs leading-relaxed">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">1. Failure-Risk Score Formula (0–100)</h3>
            <p className="text-slate-600">
              Scores combine rule-based indicator thresholds with statistical Z-score anomaly detection across five weighted dimensions:
            </p>
            <ul className="list-disc pl-4 text-slate-700 space-y-1 font-mono text-[11px]">
              <li>HTTP / Application Error Rate: up to 32 pts</li>
              <li>P95 Response Latency & Z-Score: up to 22 pts</li>
              <li>Memory & CPU Saturation: up to 22 pts</li>
              <li>DB Connection Pool Utilization: up to 14 pts</li>
              <li>Repeated Exception Cluster Bursts: up to 10 pts</li>
            </ul>
            <p className="text-slate-600 pt-1">
              Classifications: <span className="font-semibold">Normal (0–29)</span>,{' '}
              <span className="font-semibold">Warning (30–59)</span>,{' '}
              <span className="font-semibold">High Risk (60–79)</span>,{' '}
              <span className="font-semibold">Critical (80–100)</span>. Predictions are evidence-based estimates, never guaranteed crash times.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">2. REST & Prometheus Endpoints</h3>
            <ul className="space-y-1.5 font-mono text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded p-3">
              <li>POST /api/auth/login — Authenticate & issue Bearer token</li>
              <li>GET  /api/overview?appId=... — App health, prediction, clusters, alerts</li>
              <li>POST /api/logs/ingest — Multi-format batch log parser + secret masking</li>
              <li>POST /api/scenarios/run — Controlled failure & 10k benchmark runner</li>
              <li>POST /api/incidents/:id/explain — Sanitized Gemini plain-language RCA</li>
              <li>POST /api/incidents/:id/fixes — Record fix & capture pre-fix baseline</li>
              <li>POST /api/fixes/:id/verify — Compare pre-fix vs post-fix telemetry</li>
              <li>GET  /metrics — Prometheus text exposition metrics</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            SRS Verification Matrix (Functional & Nonfunctional Coverage)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">SRS Group</th>
                <th className="py-2.5 px-4">IDs Covered</th>
                <th className="py-2.5 px-4">Implemented System Capability</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700">
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">4.1 Application & Log Mgmt</td>
                <td className="py-2.5 px-4 font-mono">SFA-FR-001..004</td>
                <td className="py-2.5 px-4">App registration, JSON/text/stack-trace ingestion, field extraction, non-blocking invalid entry reporting.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">4.2 Error & Root-Cause Analysis</td>
                <td className="py-2.5 px-4 font-mono">SFA-FR-005..010</td>
                <td className="py-2.5 px-4">Normalized signature clustering, frequency counts, affected component isolation, evidence-backed Probable vs Confirmed RCA.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">4.3 Predictive Failure Detection</td>
                <td className="py-2.5 px-4 font-mono">SFA-FR-011..017</td>
                <td className="py-2.5 px-4">0–100 risk score, 4 risk levels, contributing factor breakdown, Z-score anomaly flag, non-guarantee disclaimer.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">4.4 Alerts & Incidents</td>
                <td className="py-2.5 px-4 font-mono">SFA-FR-018..022</td>
                <td className="py-2.5 px-4">Threshold-triggered alerts with indicators, alert acknowledgement, Open/Investigating/Mitigated/Resolved lifecycle.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">4.5 Fix Recommendation & Verification</td>
                <td className="py-2.5 px-4 font-mono">SFA-FR-023..027</td>
                <td className="py-2.5 px-4">Human-reviewed corrective actions, fix recording, configurable window, pre-fix vs post-fix Improved/Similar/Worse verdict.</td>
              </tr>
              <tr>
                <td className="py-2.5 px-4 font-semibold text-slate-900">5.x Performance, Safety & Security</td>
                <td className="py-2.5 px-4 font-mono">SFA-NFR-001..015</td>
                <td className="py-2.5 px-4">10,000-record ingestion &lt;1s, no auto-destructive actions, RBAC auth, secret masking before display &amp; Gemini AI, audit log.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
