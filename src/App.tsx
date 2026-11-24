import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  BookOpen,
  CheckSquare,
  FileSearch,
  Layers,
  LogOut,
  Menu,
  RefreshCw,
  Settings,
  X,
} from 'lucide-react';
import { api, getStoredToken, setStoredToken } from './api';
import { AlertsIncidentsView } from './components/AlertsIncidentsView';
import { AppsAdminView } from './components/AppsAdminView';
import { DocumentationView } from './components/DocumentationView';
import { FixVerificationView } from './components/FixVerificationView';
import { HealthDashboard } from './components/HealthDashboard';
import { IncidentDetailsView } from './components/IncidentDetailsView';
import { LoginView } from './components/LoginView';
import { LogsScenariosView } from './components/LogsScenariosView';
import type { IncidentStatus, OverviewResponse, UserProfile } from './types';

type TabKey =
  | 'dashboard'
  | 'alerts'
  | 'incident-details'
  | 'verification'
  | 'logs'
  | 'admin'
  | 'docs';

const NAV_ITEMS: Array<{ id: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Health Dashboard', icon: Activity },
  { id: 'alerts', label: 'Alerts & Incidents', icon: Bell },
  { id: 'incident-details', label: 'Incident & RCA', icon: Layers },
  { id: 'verification', label: 'Fix Verification', icon: CheckSquare },
  { id: 'logs', label: 'Logs & Scenarios', icon: FileSearch },
  { id: 'admin', label: 'Apps & Settings', icon: Settings },
  { id: 'docs', label: 'Documentation', icon: BookOpen },
];

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [selectedAppId, setSelectedAppId] = useState<string | undefined>(undefined);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const fetchOverview = useCallback(
    async (targetAppId?: string) => {
      if (!user) return;
      setLoadingOverview(true);
      setGlobalError(null);
      try {
        const res = await api.getOverview(targetAppId ?? selectedAppId);
        setOverview(res);
        if (!selectedAppId && res.activeApp) {
          setSelectedAppId(res.activeApp.id);
        }
        if (!selectedIncidentId && res.incidents.length > 0) {
          setSelectedIncidentId(res.incidents[0].id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load workspace';
        if (msg.toLowerCase().includes('authentication') || msg.toLowerCase().includes('session')) {
          setStoredToken(null);
          setUser(null);
        } else {
          setGlobalError(msg);
        }
      } finally {
        setLoadingOverview(false);
      }
    },
    [user, selectedAppId, selectedIncidentId]
  );

  // Restore existing session if token exists
  useEffect(() => {
    async function restore() {
      const token = getStoredToken();
      if (!token) {
        setAuthChecked(true);
        return;
      }
      try {
        const res = await api.me();
        setUser(res.user);
      } catch {
        setStoredToken(null);
      } finally {
        setAuthChecked(true);
      }
    }
    restore();
  }, []);

  useEffect(() => {
    if (user) {
      fetchOverview(selectedAppId);
    }
  }, [user, selectedAppId, fetchOverview]);

  // Periodic indicator monitoring interval (SFA-FR-011)
  useEffect(() => {
    if (!user || !overview?.activeApp) return;
    const intervalMs = Math.max(15, overview.activeApp.thresholds.pollingIntervalSec) * 1000;
    const timer = setInterval(() => {
      fetchOverview(overview.activeApp?.id);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [user, overview?.activeApp, fetchOverview]);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // Clear local session regardless
    }
    setStoredToken(null);
    setUser(null);
    setOverview(null);
  }

  async function handleConfirmCluster(clusterId: string) {
    await api.confirmClusterCause(clusterId);
    await fetchOverview();
  }

  async function handleAcknowledgeAlert(alertId: string) {
    await api.acknowledgeAlert(alertId);
    await fetchOverview();
  }

  async function handleUpdateIncident(
    incidentId: string,
    payload: { status?: IncidentStatus; confirmedCause?: string }
  ) {
    await api.updateIncident(incidentId, payload);
    await fetchOverview();
  }

  async function handleRecordFix(
    incidentId: string,
    payload: { fixSummary: string; selectedRecommendation?: string; verificationWindowSec: number }
  ) {
    await api.recordFix(incidentId, payload);
    await fetchOverview();
  }

  async function handleVerifyFix(fixId: string, outcome: 'recovery' | 'regression' | 'current') {
    await api.verifyFix(fixId, outcome);
    await fetchOverview();
  }

  function handleOpenIncident(incidentId: string) {
    const inc = overview?.allIncidents.find((i) => i.id === incidentId);
    if (inc && inc.appId !== selectedAppId) {
      setSelectedAppId(inc.appId);
    }
    setSelectedIncidentId(incidentId);
    setActiveTab('incident-details');
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-xs text-slate-500">
        Verifying session...
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoginSuccess={(u) => setUser(u)} />;
  }

  const activeNav = NAV_ITEMS.find((n) => n.id === activeTab);
  const unackedCount = overview?.allAlertsCount ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-white border-r border-slate-200 min-h-screen sticky top-0 h-screen no-print">
        <div className="px-5 py-5 border-b border-slate-200">
          <div className="text-sm font-bold tracking-tight text-slate-900">
            Failure Analyzer
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Proactive Reliability Console
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'alerts' && unackedCount > 0 && (
                  <span
                    className={`text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {unackedCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="text-xs font-semibold text-slate-900 truncate">{user.displayName}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {user.role} · {user.username}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 w-full py-1.5 px-3 text-xs font-medium border border-slate-300 rounded-md text-slate-700 hover:bg-slate-100 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">Failure Analyzer</span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1 text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-md ${
                      isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-900">{user.displayName}</div>
              <div className="text-[11px] text-slate-500">{user.role}</div>
              <button
                type="button"
                onClick={handleLogout}
                className="mt-3 w-full py-1.5 text-xs font-medium border border-slate-300 rounded-md"
              >
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header Bar (3-zone contract: Breadcrumb — App Selector — Refresh Action) */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-6 sticky top-0 z-20 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 border border-slate-200 rounded"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs text-slate-500 truncate">
              <span>Workspace</span>
              <span className="mx-1.5">/</span>
              <span className="text-slate-700 font-medium">
                {overview?.activeApp?.name ?? 'Select App'}
              </span>
              <span className="mx-1.5">/</span>
              <span className="text-slate-900 font-semibold">{activeNav?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {overview && overview.apps.length > 0 && (
              <select
                aria-label="Select monitored application"
                value={selectedAppId ?? overview.activeApp?.id ?? ''}
                onChange={(e) => setSelectedAppId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white text-slate-900 max-w-[220px]"
              >
                {overview.apps.map((app) => {
                  const pred = overview.allPredictions[app.id];
                  return (
                    <option key={app.id} value={app.id}>
                      {app.name} ({pred ? `${pred.riskScore}/100` : '—'})
                    </option>
                  );
                })}
              </select>
            )}

            <button
              type="button"
              onClick={() => fetchOverview()}
              disabled={loadingOverview}
              className="px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {globalError && (
            <div className="mb-5 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-700">
              {globalError}
            </div>
          )}

          {!overview ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
              Loading application telemetry and failure analysis...
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <HealthDashboard
                  activeApp={overview.activeApp}
                  prediction={overview.prediction}
                  metrics={overview.metrics}
                  clusters={overview.clusters}
                  alerts={overview.alerts}
                  incidents={overview.incidents}
                  totalLogCount={overview.totalLogCount}
                  invalidLogCount={overview.invalidLogCount}
                  userRole={user.role}
                  onOpenIncident={handleOpenIncident}
                  onConfirmCluster={handleConfirmCluster}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                  onNavigate={(t) => setActiveTab(t as TabKey)}
                />
              )}

              {activeTab === 'alerts' && (
                <AlertsIncidentsView
                  apps={overview.apps}
                  alerts={overview.allAlerts}
                  incidents={overview.allIncidents}
                  userRole={user.role}
                  onAcknowledgeAlert={handleAcknowledgeAlert}
                  onUpdateIncidentStatus={(id, status) => handleUpdateIncident(id, { status })}
                  onSelectIncident={handleOpenIncident}
                />
              )}

              {activeTab === 'incident-details' && (
                <IncidentDetailsView
                  incidents={overview.allIncidents}
                  selectedIncidentId={selectedIncidentId}
                  clusters={overview.clusters}
                  fixes={overview.allFixes}
                  userRole={user.role}
                  onSelectIncident={setSelectedIncidentId}
                  onUpdateIncident={handleUpdateIncident}
                  onRecordFix={handleRecordFix}
                  onOpenVerification={() => setActiveTab('verification')}
                />
              )}

              {activeTab === 'verification' && (
                <FixVerificationView
                  fixes={overview.allFixes}
                  incidents={overview.allIncidents}
                  userRole={user.role}
                  onVerifyFix={handleVerifyFix}
                  onOpenIncident={handleOpenIncident}
                />
              )}

              {activeTab === 'logs' && (
                <LogsScenariosView
                  activeApp={overview.activeApp}
                  apps={overview.apps}
                  userRole={user.role}
                  onDataUpdated={() => fetchOverview()}
                />
              )}

              {activeTab === 'admin' && (
                <AppsAdminView
                  apps={overview.apps}
                  activeApp={overview.activeApp}
                  userRole={user.role}
                  onSelectApp={(id) => setSelectedAppId(id)}
                  onDataUpdated={() => fetchOverview()}
                />
              )}

              {activeTab === 'docs' && <DocumentationView />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
