import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Settings, Shield } from 'lucide-react';
import { api } from '../api';
import type { AuditLogEntry, MonitoredApp, UserProfile, UserRole } from '../types';
import { formatShortTime } from './TelemetryCharts';

interface AppsAdminViewProps {
  apps: MonitoredApp[];
  activeApp: MonitoredApp | null;
  userRole: UserRole;
  onSelectApp: (appId: string) => void;
  onDataUpdated: () => Promise<void>;
}

export const AppsAdminView: React.FC<AppsAdminViewProps> = ({
  apps,
  activeApp,
  userRole,
  onSelectApp,
  onDataUpdated,
}) => {
  const isAdmin = userRole === 'Administrator';
  const canReset = userRole === 'Administrator' || userRole === 'Tester';

  // New App form
  const [newName, setNewName] = useState('');
  const [newEnv, setNewEnv] = useState<'production' | 'staging' | 'development'>('production');
  const [newDesc, setNewDesc] = useState('');
  const [newComponents, setNewComponents] = useState('api-gateway, db-pool, worker-runtime');
  const [newNotify, setNewNotify] = useState('ops-alerts@sfa-project.edu');

  // Edit Thresholds state for activeApp
  const [alertTriggerScore, setAlertTriggerScore] = useState(activeApp?.thresholds.alertTriggerScore ?? 60);
  const [maxErrorRatePct, setMaxErrorRatePct] = useState(activeApp?.thresholds.maxErrorRatePct ?? 3.5);
  const [maxLatencyMs, setMaxLatencyMs] = useState(activeApp?.thresholds.maxLatencyMs ?? 650);
  const [verificationWindowSec, setVerificationWindowSec] = useState(
    activeApp?.thresholds.verificationWindowSec ?? 60
  );
  const [notificationTarget, setNotificationTarget] = useState(
    activeApp?.notificationTarget ?? ''
  );

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (activeApp) {
      setAlertTriggerScore(activeApp.thresholds.alertTriggerScore);
      setMaxErrorRatePct(activeApp.thresholds.maxErrorRatePct);
      setMaxLatencyMs(activeApp.thresholds.maxLatencyMs);
      setVerificationWindowSec(activeApp.thresholds.verificationWindowSec);
      setNotificationTarget(activeApp.notificationTarget);
    }
  }, [activeApp]);

  async function loadAdminLists() {
    try {
      const [uRes, aRes] = await Promise.all([api.getUsers(), api.getAuditLogs()]);
      setUsers(uRes.users);
      setAuditLogs(aRes.auditLogs);
    } catch {
      // Ignore secondary fetch error
    }
  }

  useEffect(() => {
    loadAdminLists();
  }, [apps.length]);

  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setErrorMsg(null);
    try {
      const res = await api.createApp({
        name: newName,
        environment: newEnv,
        owner: 'Gouri Yadav',
        description: newDesc,
        components: newComponents
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notificationTarget: newNotify,
        thresholds: {
          alertTriggerScore: 60,
          verificationWindowSec: 60,
        },
      });
      setNewName('');
      setNewDesc('');
      setFeedback(`Registered monitored application "${res.app.name}".`);
      onSelectApp(res.app.id);
      await Promise.all([onDataUpdated(), loadAdminLists()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to register app');
    }
  }

  async function handleSaveThresholds(e: React.FormEvent) {
    e.preventDefault();
    if (!activeApp) return;
    setFeedback(null);
    setErrorMsg(null);
    try {
      await api.updateThresholds(activeApp.id, {
        notificationTarget,
        thresholds: {
          alertTriggerScore,
          maxErrorRatePct,
          maxLatencyMs,
          verificationWindowSec,
        },
      });
      setFeedback(`Updated monitoring thresholds for ${activeApp.name}.`);
      await Promise.all([onDataUpdated(), loadAdminLists()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update thresholds');
    }
  }

  async function handleResetDemo() {
    setFeedback(null);
    setErrorMsg(null);
    try {
      await api.resetDemo();
      setFeedback('Workspace restored to initial seeded SRS baseline.');
      await Promise.all([onDataUpdated(), loadAdminLists()]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reset failed');
    }
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-xs text-emerald-800">
          {feedback}
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
          Signed in as <span className="font-semibold">{userRole}</span>. Application registration and threshold updates are restricted to the <span className="font-semibold">Administrator</span> role (SFA-NFR-010).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Register Application (SFA-FR-001) */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Register Monitored Application
            </h2>
          </div>
          <form onSubmit={handleCreateApp} className="mt-4 space-y-3 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Application Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Library Auth Service"
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Environment</label>
                <select
                  value={newEnv}
                  onChange={(e) => setNewEnv(e.target.value as 'production' | 'staging' | 'development')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                >
                  <option value="production">production</option>
                  <option value="staging">staging</option>
                  <option value="development">development</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notification Target</label>
                <input
                  type="text"
                  value={newNotify}
                  onChange={(e) => setNewNotify(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">
                Components (comma-separated)
              </label>
              <input
                type="text"
                value={newComponents}
                onChange={(e) => setNewComponents(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Brief purpose of service"
                className="w-full px-3 py-2 border border-slate-300 rounded-md"
              />
            </div>
            <button
              type="submit"
              disabled={!isAdmin}
              className="px-4 py-2 bg-slate-900 text-white font-medium rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
            >
              Add Application
            </button>
          </form>
        </div>

        {/* Configure Thresholds for Active App */}
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">
                Threshold & Verification Config ({activeApp?.name ?? 'None'})
              </h2>
            </div>
            {canReset && (
              <button
                type="button"
                onClick={handleResetDemo}
                className="px-2.5 py-1 text-xs font-medium border border-slate-300 rounded hover:bg-slate-50 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Baseline</span>
              </button>
            )}
          </div>

          {activeApp && (
            <form onSubmit={handleSaveThresholds} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Alert Trigger Risk Score (0–100)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={95}
                    value={alertTriggerScore}
                    onChange={(e) => setAlertTriggerScore(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max Error Rate Limit (%)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={0.5}
                    max={50}
                    value={maxErrorRatePct}
                    onChange={(e) => setMaxErrorRatePct(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max P95 Latency Limit (ms)
                  </label>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    value={maxLatencyMs}
                    onChange={(e) => setMaxLatencyMs(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Post-Fix Verification Window (sec)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={3600}
                    value={verificationWindowSec}
                    onChange={(e) => setVerificationWindowSec(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Alert Email / Webhook Endpoint
                </label>
                <input
                  type="text"
                  value={notificationTarget}
                  onChange={(e) => setNotificationTarget(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md font-mono"
                />
              </div>
              <button
                type="submit"
                disabled={!isAdmin}
                className="px-4 py-2 bg-slate-900 text-white font-medium rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
              >
                Save Threshold Configuration
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Authorized Users & RBAC Directory */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
          <Shield className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">
            Authorized User Classes & Role Permissions (SFA-NFR-010)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Username</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Title</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 px-4 font-medium text-slate-900">{u.displayName}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{u.username}</td>
                  <td className="py-2.5 px-4 font-semibold text-slate-800">{u.role}</td>
                  <td className="py-2.5 px-4 text-slate-600">{u.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Security & Administrative Audit Log (SFA-NFR-014) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Security & Administrative Audit Log (SFA-NFR-014)
          </h2>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {auditLogs.length} entries
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Actor (Role)</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {auditLogs.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {formatShortTime(a.timestamp)}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap font-medium text-slate-900">
                    {a.actorName} ({a.actorRole})
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-800 whitespace-nowrap">
                    {a.action}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
