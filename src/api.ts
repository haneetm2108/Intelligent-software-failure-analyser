import type {
  AppThresholds,
  AuditLogEntry,
  ErrorCluster,
  FixVerificationRecord,
  IncidentRecord,
  IncidentStatus,
  IngestionResponse,
  InvalidLogEntry,
  LogEntry,
  MonitoredApp,
  OverviewResponse,
  PlainLanguageExplanation,
  UserProfile,
  UserRole,
} from './types';

const TOKEN_KEY = 'sfa_session_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Server returned non-JSON response (${res.status})`);
  }

  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`);
  }
  return json as T;
}

export const api = {
  login(payload: { username?: string; password?: string; demoRole?: UserRole }) {
    return request<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  logout() {
    return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  me() {
    return request<{ user: UserProfile }>('/api/auth/me');
  },
  getUsers() {
    return request<{ users: UserProfile[] }>('/api/auth/users');
  },
  getOverview(appId?: string) {
    const qs = appId ? `?appId=${encodeURIComponent(appId)}` : '';
    return request<OverviewResponse>(`/api/overview${qs}`);
  },
  createApp(payload: {
    name: string;
    environment: 'production' | 'staging' | 'development';
    owner: string;
    description: string;
    components: string[];
    notificationTarget: string;
    thresholds: Partial<AppThresholds>;
  }) {
    return request<{ app: MonitoredApp }>('/api/apps', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  updateThresholds(
    appId: string,
    payload: { thresholds: Partial<AppThresholds>; notificationTarget: string }
  ) {
    return request<{ app: MonitoredApp }>(`/api/apps/${encodeURIComponent(appId)}/thresholds`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  getLogs(params: {
    appId?: string;
    severity?: string;
    component?: string;
    search?: string;
    rangeMinutes?: number;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params.appId) qs.set('appId', params.appId);
    if (params.severity) qs.set('severity', params.severity);
    if (params.component) qs.set('component', params.component);
    if (params.search) qs.set('search', params.search);
    if (params.rangeMinutes) qs.set('rangeMinutes', String(params.rangeMinutes));
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      totalMatched: number;
      logs: LogEntry[];
      invalidLogs: InvalidLogEntry[];
    }>(`/api/logs?${qs.toString()}`);
  },
  ingestLogs(payload: { appId: string; rawLogs: string; source?: string }) {
    return request<IngestionResponse>('/api/logs/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  runScenario(payload: {
    appId: string;
    scenarioId:
      | 'db-pool-exhaustion'
      | 'memory-leak-oom'
      | 'http-5xx-cascade'
      | 'benchmark-10k'
      | 'post-fix-recovery'
      | 'post-fix-regression';
  }) {
    return request<IngestionResponse>('/api/scenarios/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  confirmClusterCause(clusterId: string, confirmedCause?: string) {
    return request<{ cluster: ErrorCluster }>(
      `/api/clusters/${encodeURIComponent(clusterId)}/confirm-cause`,
      {
        method: 'POST',
        body: JSON.stringify({ confirmedCause }),
      }
    );
  },
  acknowledgeAlert(alertId: string) {
    return request<{ ok: boolean }>(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
      method: 'POST',
    });
  },
  updateIncident(
    incidentId: string,
    payload: { status?: IncidentStatus; confirmedCause?: string }
  ) {
    return request<{ incident: IncidentRecord }>(
      `/api/incidents/${encodeURIComponent(incidentId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  },
  explainIncident(incidentId: string) {
    return request<PlainLanguageExplanation>(
      `/api/incidents/${encodeURIComponent(incidentId)}/explain`,
      { method: 'POST' }
    );
  },
  recordFix(
    incidentId: string,
    payload: {
      fixSummary: string;
      selectedRecommendation?: string;
      verificationWindowSec?: number;
    }
  ) {
    return request<{ fix: FixVerificationRecord; incident: IncidentRecord }>(
      `/api/incidents/${encodeURIComponent(incidentId)}/fixes`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },
  verifyFix(fixId: string, simulateOutcome: 'recovery' | 'regression' | 'current') {
    return request<{ fix: FixVerificationRecord; incident: IncidentRecord }>(
      `/api/fixes/${encodeURIComponent(fixId)}/verify`,
      {
        method: 'POST',
        body: JSON.stringify({ simulateOutcome }),
      }
    );
  },
  getAuditLogs() {
    return request<{ auditLogs: AuditLogEntry[] }>('/api/audit-logs');
  },
  resetDemo() {
    return request<{ ok: boolean }>('/api/admin/reset-demo', { method: 'POST' });
  },
};
