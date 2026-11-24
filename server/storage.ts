import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildErrorClusters } from './analyzer.ts';
import { calculateFailurePrediction } from './predictor.ts';
import { evaluateAlertsAndIncidents, evaluateFixVerification } from './alerting.ts';
import type {
  AuditLogEntry,
  MonitoredApp,
  RuntimeMetricPoint,
  StoreData,
  UserAccount,
  UserRole,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'sfa-store.json');

export function hashPassword(password: string, salt = 'sfa-university-salt'): string {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createSeedStore(): StoreData {
  const now = Date.now();
  const isoAgo = (mins: number) => new Date(now - mins * 60_000).toISOString();

  const defaultPassHash = hashPassword(process.env.SFA_DEMO_PASS || 'sfa2026!');

  const users: UserAccount[] = [
    {
      id: 'usr_haneet',
      username: 'haneet.dev',
      displayName: 'Haneet Maheshwari',
      email: 'haneet@sfa-project.edu',
      role: 'Developer',
      passwordHash: defaultPassHash,
      title: 'Lead Developer (Team Member 1)',
    },
    {
      id: 'usr_ops',
      username: 'ops.lead',
      displayName: 'Operations Lead',
      email: 'ops@sfa-project.edu',
      role: 'Operations',
      passwordHash: defaultPassHash,
      title: 'Operations & Reliability',
    },
    {
      id: 'usr_gouri',
      username: 'gouri.admin',
      displayName: 'Gouri Yadav',
      email: 'gouri@sfa-project.edu',
      role: 'Administrator',
      passwordHash: defaultPassHash,
      title: 'System Administrator (Team Member 2)',
    },
    {
      id: 'usr_tester',
      username: 'evaluator.qa',
      displayName: 'QA Evaluator',
      email: 'qa@sfa-project.edu',
      role: 'Tester',
      passwordHash: defaultPassHash,
      title: 'Tester / Project Evaluator',
    },
  ];

  const apps: MonitoredApp[] = [
    {
      id: 'app-campus-portal',
      name: 'Campus Portal API',
      environment: 'production',
      owner: 'Haneet Maheshwari',
      description: 'Core university student registration, course catalog, and authentication REST service.',
      components: ['db-pool', 'auth-service', 'api-gateway', 'worker-runtime'],
      thresholds: {
        warningScore: 30,
        highRiskScore: 60,
        criticalScore: 80,
        alertTriggerScore: 60,
        maxErrorRatePct: 3.5,
        maxLatencyMs: 650,
        maxCpuPct: 80,
        maxMemoryPct: 82,
        pollingIntervalSec: 30,
        verificationWindowSec: 60,
      },
      notificationTarget: 'ops-alerts@sfa-project.edu',
      createdAt: isoAgo(1440),
      updatedAt: isoAgo(15),
    },
    {
      id: 'app-payment-gw',
      name: 'Fee & Payment Gateway',
      environment: 'production',
      owner: 'Haneet Maheshwari',
      description: 'Tuition checkout microservice handling idempotent transaction processing and receipts.',
      components: ['payment-gateway', 'api-gateway', 'db-pool', 'cache-layer'],
      thresholds: {
        warningScore: 30,
        highRiskScore: 60,
        criticalScore: 80,
        alertTriggerScore: 55,
        maxErrorRatePct: 2.0,
        maxLatencyMs: 500,
        maxCpuPct: 75,
        maxMemoryPct: 78,
        pollingIntervalSec: 15,
        verificationWindowSec: 90,
      },
      notificationTarget: 'https://hooks.sfa-project.edu/payment-alerts',
      createdAt: isoAgo(1440),
      updatedAt: isoAgo(25),
    },
    {
      id: 'app-telemetry-worker',
      name: 'Batch Ingestion Worker',
      environment: 'staging',
      owner: 'Gouri Yadav',
      description: 'Asynchronous background worker processing student timetable exports and report queues.',
      components: ['worker-runtime', 'cache-layer', 'db-pool'],
      thresholds: {
        warningScore: 35,
        highRiskScore: 65,
        criticalScore: 85,
        alertTriggerScore: 65,
        maxErrorRatePct: 4.0,
        maxLatencyMs: 900,
        maxCpuPct: 85,
        maxMemoryPct: 85,
        pollingIntervalSec: 60,
        verificationWindowSec: 60,
      },
      notificationTarget: 'staging-ops@sfa-project.edu',
      createdAt: isoAgo(720),
      updatedAt: isoAgo(40),
    },
  ];

  // Build baseline + escalating telemetry for Campus Portal API (High Risk: DB Pool pressure)
  const metrics: RuntimeMetricPoint[] = [];
  const portalSeries = [
    { min: 55, cpu: 28, mem: 44, lat: 145, err: 0.4, db: 35, rpm: 420 },
    { min: 50, cpu: 30, mem: 45, lat: 152, err: 0.5, db: 38, rpm: 435 },
    { min: 45, cpu: 32, mem: 47, lat: 165, err: 0.6, db: 42, rpm: 460 },
    { min: 40, cpu: 35, mem: 49, lat: 185, err: 0.8, db: 48, rpm: 490 },
    { min: 35, cpu: 41, mem: 52, lat: 230, err: 1.1, db: 56, rpm: 515 },
    { min: 30, cpu: 48, mem: 55, lat: 310, err: 1.6, db: 64, rpm: 540 },
    { min: 25, cpu: 55, mem: 59, lat: 410, err: 2.3, db: 74, rpm: 560 },
    { min: 20, cpu: 62, mem: 64, lat: 560, err: 3.1, db: 83, rpm: 585 },
    { min: 15, cpu: 68, mem: 68, lat: 740, err: 4.2, db: 89, rpm: 590 },
    { min: 10, cpu: 73, mem: 72, lat: 920, err: 5.4, db: 94, rpm: 605 },
    { min: 5, cpu: 76, mem: 74, lat: 1080, err: 6.1, db: 96, rpm: 612 },
  ];
  portalSeries.forEach((pt, idx) => {
    metrics.push({
      id: `met_portal_${idx}`,
      appId: 'app-campus-portal',
      timestamp: isoAgo(pt.min),
      cpuPct: pt.cpu,
      memoryPct: pt.mem,
      latencyP95Ms: pt.lat,
      errorRatePct: pt.err,
      dbPoolPct: pt.db,
      requestsPerMin: pt.rpm,
    });
  });

  // Payment Gateway: Healthy post-fix state (had an earlier incident that was mitigated & improved!)
  const paymentSeries = [
    { min: 55, cpu: 58, mem: 61, lat: 480, err: 3.4, db: 70, rpm: 210 },
    { min: 45, cpu: 66, mem: 69, lat: 720, err: 5.1, db: 76, rpm: 225 },
    { min: 35, cpu: 69, mem: 73, lat: 790, err: 5.8, db: 78, rpm: 230 },
    { min: 25, cpu: 36, mem: 48, lat: 185, err: 0.6, db: 34, rpm: 215 },
    { min: 15, cpu: 31, mem: 45, lat: 145, err: 0.3, db: 30, rpm: 205 },
    { min: 5, cpu: 29, mem: 43, lat: 132, err: 0.2, db: 28, rpm: 198 },
  ];
  paymentSeries.forEach((pt, idx) => {
    metrics.push({
      id: `met_pay_${idx}`,
      appId: 'app-payment-gw',
      timestamp: isoAgo(pt.min),
      cpuPct: pt.cpu,
      memoryPct: pt.mem,
      latencyP95Ms: pt.lat,
      errorRatePct: pt.err,
      dbPoolPct: pt.db,
      requestsPerMin: pt.rpm,
    });
  });

  // Batch Ingestion Worker: Moderate Warning (memory drifting up)
  const workerSeries = [
    { min: 50, cpu: 34, mem: 52, lat: 240, err: 0.7, db: 40, rpm: 90 },
    { min: 40, cpu: 38, mem: 58, lat: 275, err: 0.9, db: 42, rpm: 95 },
    { min: 30, cpu: 43, mem: 64, lat: 310, err: 1.2, db: 45, rpm: 98 },
    { min: 20, cpu: 49, mem: 71, lat: 390, err: 1.8, db: 47, rpm: 102 },
    { min: 10, cpu: 54, mem: 77, lat: 460, err: 2.2, db: 49, rpm: 104 },
  ];
  workerSeries.forEach((pt, idx) => {
    metrics.push({
      id: `met_wrk_${idx}`,
      appId: 'app-telemetry-worker',
      timestamp: isoAgo(pt.min),
      cpuPct: pt.cpu,
      memoryPct: pt.mem,
      latencyP95Ms: pt.lat,
      errorRatePct: pt.err,
      dbPoolPct: pt.db,
      requestsPerMin: pt.rpm,
    });
  });

  const logs = [
    {
      id: 'log_seed_1',
      appId: 'app-campus-portal',
      timestamp: isoAgo(28),
      severity: 'INFO' as const,
      message: 'Course catalog cache warmed successfully (entries=1420)',
      source: 'campus-api-pod-01',
      component: 'cache-layer',
      latencyMs: 42,
      secretsMasked: 0,
      ingestedAt: isoAgo(28),
    },
    {
      id: 'log_seed_2',
      appId: 'app-campus-portal',
      timestamp: isoAgo(18),
      severity: 'WARN' as const,
      message: 'Slow SQL query on enrollment_ledger took 842ms (pool wait=310ms)',
      source: 'campus-api-pod-01',
      component: 'db-pool',
      latencyMs: 842,
      secretsMasked: 0,
      ingestedAt: isoAgo(18),
    },
    {
      id: 'log_seed_3',
      appId: 'app-campus-portal',
      timestamp: isoAgo(14),
      severity: 'ERROR' as const,
      message: 'Database connection pool exhausted after 5000ms timeout on postgres://svc_portal:[REDACTED:DB_PASSWORD]@db-primary:5432/campus',
      source: 'campus-api-pod-02',
      component: 'db-pool',
      latencyMs: 5002,
      httpStatus: 503,
      stackTrace:
        'Error: Connection pool exhausted (active=50/50, waiting=19)\n  at Pool.acquire (src/db/pool.ts:118:15)\n  at EnrollmentRepo.listByTerm (src/repos/enrollment.ts:44:22)',
      secretsMasked: 1,
      ingestedAt: isoAgo(14),
    },
    {
      id: 'log_seed_4',
      appId: 'app-campus-portal',
      timestamp: isoAgo(11),
      severity: 'ERROR' as const,
      message: 'Database connection pool exhausted after 5000ms timeout on postgres://svc_portal:[REDACTED:DB_PASSWORD]@db-primary:5432/campus',
      source: 'campus-api-pod-01',
      component: 'db-pool',
      latencyMs: 5011,
      httpStatus: 503,
      stackTrace:
        'Error: Connection pool exhausted (active=50/50, waiting=24)\n  at Pool.acquire (src/db/pool.ts:118:15)\n  at StudentProfileRepo.findById (src/repos/student.ts:29:18)',
      secretsMasked: 1,
      ingestedAt: isoAgo(11),
    },
    {
      id: 'log_seed_5',
      appId: 'app-campus-portal',
      timestamp: isoAgo(7),
      severity: 'ERROR' as const,
      message: 'Database connection pool exhausted after 5000ms timeout on postgres://svc_portal:[REDACTED:DB_PASSWORD]@db-primary:5432/campus',
      source: 'campus-api-pod-02',
      component: 'db-pool',
      latencyMs: 5034,
      httpStatus: 503,
      secretsMasked: 1,
      ingestedAt: isoAgo(7),
    },
    {
      id: 'log_seed_6',
      appId: 'app-campus-portal',
      timestamp: isoAgo(6),
      severity: 'WARN' as const,
      message: 'Auth token validation latency elevated (latency=420ms) for header Bearer [REDACTED:JWT]',
      source: 'campus-api-pod-01',
      component: 'auth-service',
      latencyMs: 420,
      secretsMasked: 1,
      ingestedAt: isoAgo(6),
    },
    {
      id: 'log_seed_7',
      appId: 'app-campus-portal',
      timestamp: isoAgo(4),
      severity: 'FATAL' as const,
      message: 'HTTP 503 Service Unavailable returned on GET /api/v1/enrollments due to upstream db-pool saturation',
      source: 'edge-gateway-01',
      component: 'api-gateway',
      httpStatus: 503,
      latencyMs: 5090,
      secretsMasked: 0,
      ingestedAt: isoAgo(4),
    },
    {
      id: 'log_seed_8',
      appId: 'app-payment-gw',
      timestamp: isoAgo(40),
      severity: 'ERROR' as const,
      message: 'Upstream 502 Bad Gateway from ledger-settlement host after 1200ms socket hang up',
      source: 'payment-pod-01',
      component: 'payment-gateway',
      httpStatus: 502,
      latencyMs: 1204,
      stackTrace:
        'FetchError: socket hang up at ClientRequest.<anonymous> (src/clients/ledger.ts:88:11)',
      secretsMasked: 0,
      ingestedAt: isoAgo(40),
    },
    {
      id: 'log_seed_9',
      appId: 'app-payment-gw',
      timestamp: isoAgo(12),
      severity: 'INFO' as const,
      message: 'Circuit breaker & exponential backoff applied; payment settlement latency stabilized at 132ms',
      source: 'payment-pod-01',
      component: 'payment-gateway',
      httpStatus: 200,
      latencyMs: 132,
      secretsMasked: 0,
      ingestedAt: isoAgo(12),
    },
    {
      id: 'log_seed_10',
      appId: 'app-telemetry-worker',
      timestamp: isoAgo(12),
      severity: 'WARN' as const,
      message: 'Worker heap usage reached 77% during batch timetable PDF export; GC pause 340ms',
      source: 'worker-03',
      component: 'worker-runtime',
      latencyMs: 340,
      secretsMasked: 0,
      ingestedAt: isoAgo(12),
    },
  ];

  const store: StoreData = {
    users,
    apps,
    logs,
    invalidLogs: [
      {
        appId: 'app-campus-portal',
        lineNumber: 42,
        rawSnippet: 'CORRUPT_FRAME_0x00_TRUNCATED',
        reason: 'Missing timestamp or severity token in unstructured line',
        timestamp: isoAgo(14),
      },
    ],
    metrics,
    clusters: [],
    predictions: {},
    alerts: [],
    incidents: [],
    fixes: [],
    auditLogs: [
      {
        id: 'aud_seed_1',
        timestamp: isoAgo(120),
        actorName: 'Gouri Yadav',
        actorRole: 'Administrator',
        action: 'Configured risk thresholds',
        targetType: 'Application',
        targetId: 'app-campus-portal',
        details: 'Set alert trigger score to 60 and verification window to 60s.',
      },
    ],
  };

  // Compute initial clusters, predictions, alerts, and incidents for all apps
  for (const app of store.apps) {
    const appClusters = buildErrorClusters(app.id, store.logs, store.metrics, store.clusters);
    store.clusters.push(...appClusters);
    const pred = calculateFailurePrediction(app, store.logs, store.metrics, appClusters);
    store.predictions[app.id] = pred;
    evaluateAlertsAndIncidents(store, app, pred, appClusters);
  }

  // Seed a completed historical resolved incident + verified fix for Fee & Payment Gateway
  const historicalIncId = 'INC-100';
  store.incidents.push({
    id: historicalIncId,
    appId: 'app-payment-gw',
    appName: 'Fee & Payment Gateway',
    title: 'HTTP 5xx Upstream / Gateway Cascade detected on payment-gateway',
    component: 'payment-gateway',
    severity: 'ERROR',
    riskScore: 72,
    riskLevel: 'High Risk',
    status: 'Resolved',
    failureCategory: 'HTTP 5xx Upstream / Gateway Cascade',
    probableCause:
      'Downstream dependency latency exceeded gateway timeouts, triggering aggressive client retries that amplified request saturation.',
    confirmedCause:
      'Ledger settlement client lacked retry jitter and circuit breaker isolation during peak fee deadline.',
    causeStatus: 'Confirmed',
    evidence: [
      'Observed burst of HTTP 502 Bad Gateway responses on payment-gateway.',
      'Correlated telemetry: P95 latency peaked at 790 ms and error rate hit 5.80%.',
    ],
    recommendations: [
      'Enable exponential backoff with jitter on upstream HTTP client retries.',
      'Apply circuit-breaker isolation and tighter per-route timeout budgets.',
    ],
    createdAt: isoAgo(48),
    updatedAt: isoAgo(12),
    resolvedAt: isoAgo(12),
    latestFixId: 'FIX-100',
  });

  const seededFix = evaluateFixVerification(
    {
      id: 'FIX-100',
      incidentId: historicalIncId,
      appId: 'app-payment-gw',
      appliedBy: 'Haneet Maheshwari',
      appliedAt: isoAgo(28),
      fixSummary:
        'Enabled circuit breaker (5-failure threshold) and exponential backoff with jitter on ledger client.',
      selectedRecommendation: 'Enable exponential backoff with jitter on upstream HTTP client retries.',
      verificationWindowSec: 90,
      preFixSnapshot: {
        capturedAt: isoAgo(30),
        riskScore: 74,
        riskLevel: 'High Risk',
        errorRatePct: 5.8,
        latencyP95Ms: 790,
        cpuPct: 69,
        memoryPct: 73,
        dbPoolPct: 78,
        errorCountWindow: 14,
      },
      verdict: 'Pending',
      verdictNotes: 'Collecting post-fix verification telemetry.',
    },
    {
      capturedAt: isoAgo(10),
      riskScore: 14,
      riskLevel: 'Normal',
      errorRatePct: 0.2,
      latencyP95Ms: 132,
      cpuPct: 29,
      memoryPct: 43,
      dbPoolPct: 28,
      errorCountWindow: 0,
    }
  );
  store.fixes.push(seededFix);

  return store;
}

class StoreManager {
  private data: StoreData;

  constructor() {
    this.data = this.load();
  }

  private load(): StoreData {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw) as StoreData;
        if (parsed && Array.isArray(parsed.apps) && Array.isArray(parsed.users)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to fresh seed if corrupted
    }
    const seeded = createSeedStore();
    this.persist(seeded);
    return seeded;
  }

  private persist(target: StoreData = this.data): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpPath = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2), 'utf8');
      fs.renameSync(tmpPath, STORE_PATH);
    } catch {
      // Ignore disk write failures in read-only edge cases; in-memory remains consistent
    }
  }

  getData(): StoreData {
    return this.data;
  }

  save(): void {
    // Keep logs capped at 25,000 most recent entries to keep JSON store responsive even after multiple 10k benchmarks
    if (this.data.logs.length > 25000) {
      this.data.logs = this.data.logs.slice(0, 25000);
    }
    if (this.data.invalidLogs.length > 500) {
      this.data.invalidLogs = this.data.invalidLogs.slice(0, 500);
    }
    if (this.data.auditLogs.length > 500) {
      this.data.auditLogs = this.data.auditLogs.slice(0, 500);
    }
    this.persist();
  }

  resetToSeed(): StoreData {
    this.data = createSeedStore();
    this.persist();
    return this.data;
  }

  appendAudit(
    actorName: string,
    actorRole: UserRole,
    action: string,
    targetType: AuditLogEntry['targetType'],
    targetId: string,
    details: string
  ): void {
    this.data.auditLogs.unshift({
      id: `aud_${crypto.randomUUID().slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      actorName,
      actorRole,
      action,
      targetType,
      targetId,
      details,
    });
  }

  recomputeAppAnalysis(appId: string): void {
    const app = this.data.apps.find((a) => a.id === appId);
    if (!app) return;

    const appClusters = buildErrorClusters(appId, this.data.logs, this.data.metrics, this.data.clusters);
    this.data.clusters = [
      ...this.data.clusters.filter((c) => c.appId !== appId),
      ...appClusters,
    ];

    const prediction = calculateFailurePrediction(app, this.data.logs, this.data.metrics, appClusters);
    this.data.predictions[appId] = prediction;
    evaluateAlertsAndIncidents(this.data, app, prediction, appClusters);
  }
}

export const storeManager = new StoreManager();
