import React, { useState } from 'react';
import { ShieldCheck, Lock, ArrowRight } from 'lucide-react';
import { api, setStoredToken } from '../api';
import type { UserProfile, UserRole } from '../types';

interface LoginViewProps {
  onLoginSuccess: (user: UserProfile) => void;
}

const ROLE_PROFILES: Array<{
  role: UserRole;
  name: string;
  username: string;
  scope: string;
}> = [
  {
    role: 'Developer',
    name: 'Haneet Maheshwari',
    username: 'haneet.dev',
    scope: 'Inspect errors, confirm root cause, record fixes & verify',
  },
  {
    role: 'Operations',
    name: 'Operations Lead',
    username: 'ops.lead',
    scope: 'Monitor health dashboard, acknowledge alerts, track incidents',
  },
  {
    role: 'Administrator',
    name: 'Gouri Yadav',
    username: 'gouri.admin',
    scope: 'Register applications, configure thresholds & audit logs',
  },
  {
    role: 'Tester',
    name: 'QA Evaluator',
    username: 'evaluator.qa',
    scope: 'Run controlled failure scenarios & 10,000-record benchmark',
  },
];

export const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('haneet.dev');
  const [password, setPassword] = useState('sfa2026!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCredentialSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login({ username, password });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleRoleQuickSignIn(role: UserRole) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login({ demoRole: role });
      setStoredToken(res.token);
      onLoginSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-6">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-between bg-white border border-slate-200 rounded-lg p-8">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-4">
              <ShieldCheck className="w-4 h-4 text-blue-700" />
              <span>Proactive Failure Detection & Root-Cause Console</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 max-w-xl" style={{ textWrap: 'balance' }}>
              Intelligent Software Failure Analyzer
            </h1>
            <p className="mt-4 text-sm text-slate-600 leading-relaxed max-w-xl">
              Collects application logs, stack traces, and runtime indicators to group recurring errors,
              detect abnormal latency and resource patterns, estimate failure risk from 0 to 100, and
              verify whether recorded fixes actually improved production stability.
            </p>

            <div className="mt-8 border-t border-slate-200 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
              <div>
                <h2 className="font-semibold text-slate-900">Predictive Risk Scoring</h2>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Rule-based indicators paired with Z-score anomaly detection surface contributing risk factors before crashes occur.
                </p>
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Error Clustering & RCA</h2>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Groups similar exceptions, isolates affected components, masks secrets automatically, and distinguishes probable vs confirmed causes.
                </p>
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Pre-Failure Alerts & Incidents</h2>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Generates threshold alerts with evidence and tracks incidents through Open, Investigating, Mitigated, and Resolved stages.
                </p>
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Post-Fix Verification</h2>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Compares pre-fix and post-fix snapshots across a configurable window to verify whether stability improved or regressed.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-500">
            Project Team: Haneet Maheshwari · Gouri Yadav
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
              <Lock className="w-4 h-4 text-slate-600" />
              <span>Authenticated Access</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Sign in with your assigned role to access monitored applications and incident controls.
            </p>

            <form onSubmit={handleCredentialSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="sfa-username" className="block text-xs font-medium text-slate-700 mb-1">
                  Username or Email
                </label>
                <input
                  id="sfa-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                  required
                />
              </div>
              <div>
                <label htmlFor="sfa-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  id="sfa-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-700 focus:border-blue-700"
                  required
                />
              </div>

              {error && (
                <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-7 pt-6 border-t border-slate-200">
              <div className="text-xs font-medium text-slate-700 mb-3">
                Quick Sign-In by User Class
              </div>
              <div className="space-y-2">
                {ROLE_PROFILES.map((item) => (
                  <button
                    key={item.role}
                    type="button"
                    disabled={loading}
                    onClick={() => handleRoleQuickSignIn(item.role)}
                    className="w-full text-left px-3 py-2.5 border border-slate-200 rounded-md hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900">
                        {item.role} — {item.name}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">{item.username}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{item.scope}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
