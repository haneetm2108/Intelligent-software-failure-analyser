import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { captureSnapshot, evaluateFixVerification } from './server/alerting.ts';
import { explainIncidentWithGemini } from './server/llmExplainer.ts';
import { parseLogBatch } from './server/logProcessor.ts';
import { generateScenarioPayload, type ScenarioId } from './server/scenarios.ts';
import { hashPassword, storeManager } from './server/storage.ts';
import type {
  AppThresholds,
  FixVerificationRecord,
  IncidentStatus,
  MonitoredApp,
  SessionInfo,
  UserRole,
} from './server/types.ts';

const PORT = Number(process.env.PORT || 3000);
const sessions = new Map<string, SessionInfo>();

function getBearerToken(req: express.Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required (SFA-NFR-009).' });
    return;
  }
  const session = sessions.get(token);
  if (!session) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  (req as express.Request & { session: SessionInfo }).session = session;
  next();
}

function requireRoles(allowed: UserRole[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const session = (req as express.Request & { session?: SessionInfo }).session;
    if (!session || !allowed.includes(session.role)) {
      res.status(403).json({
        error: `Permission denied (SFA-NFR-010): requires role ${allowed.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'intelligent-software-failure-analyzer' });
  });

  // Prometheus-compatible runtime metrics endpoint (Section 2.4 & 3.3)
  app.get('/metrics', (_req, res) => {
    const data = storeManager.getData();
    const lines: string[] = [
      '# HELP sfa_failure_risk_score Current failure risk score (0-100) per monitored application',
      '# TYPE sfa_failure_risk_score gauge',
    ];
    for (const monitored of data.apps) {
      const pred = data.predictions[monitored.id];
      const score = pred?.riskScore ?? 0;
      lines.push(`sfa_failure_risk_score{app="${monitored.id}",level="${pred?.riskLevel ?? 'Normal'}"} ${score}`);
    }
    lines.push('# HELP sfa_active_incidents_total Number of non-resolved incidents');
    lines.push('# TYPE sfa_active_incidents_total gauge');
    const openCount = data.incidents.filter((i) => i.status !== 'Resolved').length;
    lines.push(`sfa_active_incidents_total ${openCount}`);
    lines.push('# HELP sfa_ingested_logs_total Total valid logs stored');
    lines.push('# TYPE sfa_ingested_logs_total counter');
    lines.push(`sfa_ingested_logs_total ${data.logs.length}`);

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(`${lines.join('\n')}\n`);
  });

  // Authentication endpoints (SFA-NFR-009)
  app.post('/api/auth/login', (req, res) => {
    const { username, password, demoRole } = req.body as {
      username?: string;
      password?: string;
      demoRole?: UserRole;
    };
    const data = storeManager.getData();

    let user = undefined;
    if (demoRole) {
      user = data.users.find((u) => u.role === demoRole);
    } else if (username && password) {
      const expectedHash = hashPassword(password);
      user = data.users.find(
        (u) =>
          (u.username.toLowerCase() === username.toLowerCase() ||
            u.email.toLowerCase() === username.toLowerCase()) &&
          u.passwordHash === expectedHash
      );
    }

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const token = crypto.randomBytes(24).toString('hex');
    const session: SessionInfo = {
      token,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: new Date().toISOString(),
    };
    sessions.set(token, session);

    storeManager.appendAudit(
      user.displayName,
      user.role,
      'User signed in',
      'Auth',
      user.id,
      `Authenticated session started as ${user.role}.`
    );
    storeManager.save();

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        title: user.title,
      },
    });
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = getBearerToken(req);
    const session = (req as express.Request & { session: SessionInfo }).session;
    if (token) sessions.delete(token);
    storeManager.appendAudit(
      session.displayName,
      session.role,
      'User signed out',
      'Auth',
      session.userId,
      'Session terminated by user.'
    );
    storeManager.save();
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const session = (req as express.Request & { session: SessionInfo }).session;
    const data = storeManager.getData();
    const user = data.users.find((u) => u.id === session.userId);
    res.json({
      user: user
        ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            title: user.title,
          }
        : session,
    });
  });

  app.get('/api/auth/users', requireAuth, (_req, res) => {
    const data = storeManager.getData();
    res.json({
      users: data.users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        email: u.email,
        role: u.role,
        title: u.title,
      })),
    });
  });

  // Main workspace overview
  app.get('/api/overview', requireAuth, (req, res) => {
    const data = storeManager.getData();
    const requestedAppId = typeof req.query.appId === 'string' ? req.query.appId : undefined;
    const activeApp =
      data.apps.find((a) => a.id === requestedAppId) ?? data.apps[0] ?? null;

    const appMetrics = activeApp
      ? data.metrics
          .filter((m) => m.appId === activeApp.id)
          .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
          .slice(-30)
      : [];

    const appClusters = activeApp
      ? data.clusters.filter((c) => c.appId === activeApp.id)
      : [];

    const appAlerts = data.alerts
      .filter((a) => !activeApp || a.appId === activeApp.id)
      .slice(0, 50);

    const appIncidents = data.incidents
      .filter((i) => !activeApp || i.appId === activeApp.id)
      .slice(0, 50);

    const appFixes = data.fixes
      .filter((f) => !activeApp || f.appId === activeApp.id)
      .slice(0, 30);

    res.json({
      apps: data.apps,
      activeApp,
      prediction: activeApp ? data.predictions[activeApp.id] ?? null : null,
      allPredictions: data.predictions,
      metrics: appMetrics,
      clusters: appClusters,
      alerts: appAlerts,
      allAlerts: data.alerts.slice(0, 50),
      allAlertsCount: data.alerts.filter((a) => !a.acknowledged).length,
      incidents: appIncidents,
      allIncidents: data.incidents,
      fixes: appFixes,
      allFixes: data.fixes.slice(0, 50),
      totalLogCount: activeApp
        ? data.logs.filter((l) => l.appId === activeApp.id).length
        : data.logs.length,
      invalidLogCount: activeApp
        ? data.invalidLogs.filter((l) => l.appId === activeApp.id).length
        : data.invalidLogs.length,
    });
  });

  // Application management (SFA-FR-001)
  app.post(
    '/api/apps',
    requireAuth,
    requireRoles(['Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const body = req.body as Partial<MonitoredApp>;
      if (!body.name || !body.name.trim()) {
        res.status(400).json({ error: 'Application name is required.' });
        return;
      }

      const data = storeManager.getData();
      const id = `app-${body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${crypto.randomUUID().slice(0, 4)}`;
      const nowIso = new Date().toISOString();

      const newApp: MonitoredApp = {
        id,
        name: body.name.trim(),
        environment: body.environment ?? 'production',
        owner: body.owner?.trim() || session.displayName,
        description: body.description?.trim() || 'Monitored application service.',
        components:
          Array.isArray(body.components) && body.components.length > 0
            ? body.components
            : ['api-gateway', 'db-pool', 'worker-runtime'],
        thresholds: {
          warningScore: body.thresholds?.warningScore ?? 30,
          highRiskScore: body.thresholds?.highRiskScore ?? 60,
          criticalScore: body.thresholds?.criticalScore ?? 80,
          alertTriggerScore: body.thresholds?.alertTriggerScore ?? 60,
          maxErrorRatePct: body.thresholds?.maxErrorRatePct ?? 3.5,
          maxLatencyMs: body.thresholds?.maxLatencyMs ?? 650,
          maxCpuPct: body.thresholds?.maxCpuPct ?? 80,
          maxMemoryPct: body.thresholds?.maxMemoryPct ?? 82,
          pollingIntervalSec: body.thresholds?.pollingIntervalSec ?? 30,
          verificationWindowSec: body.thresholds?.verificationWindowSec ?? 60,
        },
        notificationTarget: body.notificationTarget?.trim() || 'ops-alerts@sfa-project.edu',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      data.apps.push(newApp);
      data.metrics.push({
        id: `met_${crypto.randomUUID().slice(0, 8)}`,
        appId: id,
        timestamp: nowIso,
        cpuPct: 24,
        memoryPct: 40,
        latencyP95Ms: 135,
        errorRatePct: 0.3,
        dbPoolPct: 28,
        requestsPerMin: 180,
      });

      storeManager.recomputeAppAnalysis(id);
      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Registered monitored application',
        'Application',
        id,
        `Added "${newApp.name}" (${newApp.environment}) with alert threshold ${newApp.thresholds.alertTriggerScore}.`
      );
      storeManager.save();

      res.status(201).json({ app: newApp, prediction: data.predictions[id] });
    }
  );

  app.put(
    '/api/apps/:appId/thresholds',
    requireAuth,
    requireRoles(['Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { appId } = req.params;
      const data = storeManager.getData();
      const target = data.apps.find((a) => a.id === appId);
      if (!target) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }

      const { thresholds, notificationTarget } = req.body as {
        thresholds?: Partial<AppThresholds>;
        notificationTarget?: string;
      };

      if (thresholds) {
        target.thresholds = {
          ...target.thresholds,
          ...thresholds,
        };
      }
      if (typeof notificationTarget === 'string' && notificationTarget.trim()) {
        target.notificationTarget = notificationTarget.trim();
      }
      target.updatedAt = new Date().toISOString();

      storeManager.recomputeAppAnalysis(appId);
      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Updated application thresholds',
        'Application',
        appId,
        `Updated alert trigger to ${target.thresholds.alertTriggerScore}, error limit ${target.thresholds.maxErrorRatePct}%, verification window ${target.thresholds.verificationWindowSec}s.`
      );
      storeManager.save();

      res.json({ app: target, prediction: data.predictions[appId] });
    }
  );

  // Searchable & filterable log viewer (SFA-FR-029)
  app.get('/api/logs', requireAuth, (req, res) => {
    const data = storeManager.getData();
    const appId = typeof req.query.appId === 'string' ? req.query.appId : undefined;
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const component = typeof req.query.component === 'string' ? req.query.component : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase().trim() : '';
    const rangeMinutes = req.query.rangeMinutes ? Number(req.query.rangeMinutes) : 0;
    const limit = Math.min(Number(req.query.limit || 150), 500);

    const cutoff = rangeMinutes > 0 ? Date.now() - rangeMinutes * 60_000 : 0;

    const filtered = data.logs.filter((log) => {
      if (appId && appId !== 'all' && log.appId !== appId) return false;
      if (severity && severity !== 'all' && log.severity !== severity) return false;
      if (component && component !== 'all' && log.component !== component) return false;
      if (cutoff > 0 && Date.parse(log.timestamp) < cutoff) return false;
      if (search) {
        const hay = `${log.message} ${log.component} ${log.source} ${log.stackTrace ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const sorted = filtered.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const invalid = data.invalidLogs
      .filter((inv) => !appId || appId === 'all' || inv.appId === appId)
      .slice(0, 50);

    res.json({
      totalMatched: sorted.length,
      logs: sorted.slice(0, limit),
      invalidLogs: invalid,
    });
  });

  // Log & stack-trace ingestion (SFA-FR-002..004, SFA-NFR-001)
  app.post(
    '/api/logs/ingest',
    requireAuth,
    requireRoles(['Developer', 'Administrator', 'Tester']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { appId, rawLogs, source } = req.body as {
        appId?: string;
        rawLogs?: string;
        source?: string;
      };

      const data = storeManager.getData();
      const targetApp = data.apps.find((a) => a.id === appId);
      if (!targetApp) {
        res.status(404).json({ error: 'Target monitored application not found.' });
        return;
      }
      if (!rawLogs || !rawLogs.trim()) {
        res.status(400).json({ error: 'Log payload is empty.' });
        return;
      }

      const parsed = parseLogBatch(targetApp.id, rawLogs, source || 'manual-upload');

      if (parsed.validEntries.length > 0) {
        data.logs = [...parsed.validEntries.reverse(), ...data.logs];
      }
      if (parsed.invalidEntries.length > 0) {
        const taggedInvalid = parsed.invalidEntries.map((inv) => ({
          ...inv,
          appId: targetApp.id,
        }));
        data.invalidLogs = [...taggedInvalid, ...data.invalidLogs];
      }

      // Derive runtime metric snapshot from batch error/latency ratios if substantial batch
      if (parsed.validEntries.length >= 5) {
        const errCount = parsed.validEntries.filter(
          (l) => l.severity === 'ERROR' || l.severity === 'FATAL'
        ).length;
        const errRate = Math.round((errCount / parsed.validEntries.length) * 10000) / 100;
        const latencies = parsed.validEntries
          .map((l) => l.latencyMs)
          .filter((v): v is number => typeof v === 'number')
          .sort((a, b) => a - b);
        const p95 =
          latencies.length > 0
            ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1]
            : 210;

        const prevMetric = data.metrics
          .filter((m) => m.appId === targetApp.id)
          .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

        data.metrics.push({
          id: `met_${crypto.randomUUID().slice(0, 8)}`,
          appId: targetApp.id,
          timestamp: new Date().toISOString(),
          cpuPct: Math.min(96, (prevMetric?.cpuPct ?? 35) + (errRate > 4 ? 14 : 0)),
          memoryPct: prevMetric?.memoryPct ?? 52,
          latencyP95Ms: Math.round(p95),
          errorRatePct: errRate,
          dbPoolPct: Math.min(99, (prevMetric?.dbPoolPct ?? 45) + (errRate > 4 ? 18 : 0)),
          requestsPerMin: Math.max(prevMetric?.requestsPerMin ?? 250, parsed.validEntries.length),
        });
      }

      storeManager.recomputeAppAnalysis(targetApp.id);
      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Ingested log batch',
        'Ingestion',
        targetApp.id,
        `Processed ${parsed.totalLines} lines in ${parsed.processingMs}ms (${parsed.validEntries.length} valid, ${parsed.invalidEntries.length} invalid, ${parsed.secretsMaskedCount} secrets masked).`
      );
      storeManager.save();

      res.json({
        appId: targetApp.id,
        totalLines: parsed.totalLines,
        validCount: parsed.validEntries.length,
        invalidCount: parsed.invalidEntries.length,
        invalidSample: parsed.invalidEntries.slice(0, 20),
        secretsMaskedCount: parsed.secretsMaskedCount,
        processingMs: parsed.processingMs,
        prediction: data.predictions[targetApp.id],
      });
    }
  );

  // Controlled failure scenarios & 10,000-record performance test (Section 2.3 & 5.4 Testability)
  app.post(
    '/api/scenarios/run',
    requireAuth,
    requireRoles(['Developer', 'Administrator', 'Tester']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { appId, scenarioId } = req.body as {
        appId?: string;
        scenarioId?: ScenarioId;
      };
      const data = storeManager.getData();
      const targetApp = data.apps.find((a) => a.id === appId);
      if (!targetApp) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }
      if (!scenarioId) {
        res.status(400).json({ error: 'scenarioId is required.' });
        return;
      }

      const generated = generateScenarioPayload(scenarioId);
      const parsed = parseLogBatch(targetApp.id, generated.rawLogs, `scenario:${scenarioId}`);

      if (parsed.validEntries.length > 0) {
        data.logs = [...parsed.validEntries.reverse(), ...data.logs];
      }
      if (parsed.invalidEntries.length > 0) {
        const tagged = parsed.invalidEntries.map((inv) => ({ ...inv, appId: targetApp.id }));
        data.invalidLogs = [...tagged, ...data.invalidLogs];
      }

      for (const m of generated.metrics) {
        data.metrics.push({
          id: `met_${crypto.randomUUID().slice(0, 8)}`,
          appId: targetApp.id,
          ...m,
        });
      }

      storeManager.recomputeAppAnalysis(targetApp.id);
      storeManager.appendAudit(
        session.displayName,
        session.role,
        `Executed scenario: ${generated.name}`,
        'Ingestion',
        targetApp.id,
        `Ingested ${parsed.validEntries.length} valid / ${parsed.invalidEntries.length} invalid logs in ${parsed.processingMs}ms (${parsed.secretsMaskedCount} secrets masked).`
      );
      storeManager.save();

      res.json({
        scenarioName: generated.name,
        description: generated.description,
        totalLines: parsed.totalLines,
        validCount: parsed.validEntries.length,
        invalidCount: parsed.invalidEntries.length,
        invalidSample: parsed.invalidEntries.slice(0, 15),
        secretsMaskedCount: parsed.secretsMaskedCount,
        processingMs: parsed.processingMs,
        prediction: data.predictions[targetApp.id],
      });
    }
  );

  // Confirm root cause on cluster (SFA-FR-010: distinguish Probable vs Confirmed)
  app.post(
    '/api/clusters/:clusterId/confirm-cause',
    requireAuth,
    requireRoles(['Developer', 'Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { clusterId } = req.params;
      const { confirmedCause } = req.body as { confirmedCause?: string };
      const data = storeManager.getData();
      const cluster = data.clusters.find((c) => c.id === clusterId);
      if (!cluster) {
        res.status(404).json({ error: 'Error cluster not found.' });
        return;
      }

      cluster.causeStatus = 'Confirmed';
      cluster.confirmedCause = confirmedCause?.trim() || cluster.probableCause;
      cluster.confirmedBy = session.displayName;
      cluster.confirmedAt = new Date().toISOString();

      // Propagate to matching open incident
      for (const inc of data.incidents) {
        if (inc.clusterId === cluster.id || (inc.appId === cluster.appId && inc.component === cluster.component && inc.status !== 'Resolved')) {
          inc.causeStatus = 'Confirmed';
          inc.confirmedCause = cluster.confirmedCause;
          inc.updatedAt = new Date().toISOString();
        }
      }

      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Confirmed root cause',
        'Incident',
        cluster.id,
        `Promoted cause from Probable to Confirmed: ${cluster.confirmedCause}`
      );
      storeManager.save();

      res.json({ cluster });
    }
  );

  // Acknowledge alert (SFA-FR-020)
  app.post(
    '/api/alerts/:alertId/acknowledge',
    requireAuth,
    requireRoles(['Developer', 'Operations', 'Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { alertId } = req.params;
      const data = storeManager.getData();
      const alert = data.alerts.find((a) => a.id === alertId);
      if (!alert) {
        res.status(404).json({ error: 'Alert not found.' });
        return;
      }

      alert.acknowledged = true;
      alert.acknowledgedBy = session.displayName;
      alert.acknowledgedAt = new Date().toISOString();

      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Acknowledged alert',
        'Alert',
        alert.id,
        `Acknowledged ${alert.riskLevel} alert for ${alert.appName} (risk ${alert.riskScore}/100).`
      );
      storeManager.save();

      res.json({ alert });
    }
  );

  // Update incident status or confirm root cause (SFA-FR-010, SFA-FR-021)
  app.patch(
    '/api/incidents/:incidentId',
    requireAuth,
    requireRoles(['Developer', 'Operations', 'Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { incidentId } = req.params;
      const { status, confirmedCause } = req.body as {
        status?: IncidentStatus;
        confirmedCause?: string;
      };
      const data = storeManager.getData();
      const incident = data.incidents.find((i) => i.id === incidentId);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }

      if (status) {
        incident.status = status;
        if (status === 'Resolved') {
          incident.resolvedAt = new Date().toISOString();
        }
      }
      if (typeof confirmedCause === 'string' && confirmedCause.trim()) {
        incident.causeStatus = 'Confirmed';
        incident.confirmedCause = confirmedCause.trim();
        if (incident.clusterId) {
          const cluster = data.clusters.find((c) => c.id === incident.clusterId);
          if (cluster) {
            cluster.causeStatus = 'Confirmed';
            cluster.confirmedCause = incident.confirmedCause;
            cluster.confirmedBy = session.displayName;
            cluster.confirmedAt = new Date().toISOString();
          }
        }
      }
      incident.updatedAt = new Date().toISOString();

      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Updated incident',
        'Incident',
        incident.id,
        `Status: ${incident.status}, Cause Status: ${incident.causeStatus}.`
      );
      storeManager.save();

      res.json({ incident });
    }
  );

  // Plain-language incident explanation via Gemini API (SFA-NFR-008, SFA-NFR-015)
  app.post('/api/incidents/:incidentId/explain', requireAuth, async (req, res) => {
    const session = (req as express.Request & { session: SessionInfo }).session;
    const { incidentId } = req.params;
    const data = storeManager.getData();
    const incident = data.incidents.find((i) => i.id === incidentId);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found.' });
      return;
    }

    const linkedCluster = incident.clusterId
      ? data.clusters.find((c) => c.id === incident.clusterId)
      : data.clusters.find((c) => c.appId === incident.appId && c.component === incident.component);

    const result = await explainIncidentWithGemini(incident, linkedCluster?.sampleStackTrace);

    storeManager.appendAudit(
      session.displayName,
      session.role,
      'Requested AI evidence explanation',
      'AI',
      incident.id,
      result.available
        ? `Generated sanitized explanation via ${result.model}.`
        : `Fallback active: ${result.errorMessage ?? 'AI service unavailable'}.`
    );
    storeManager.save();

    res.json(result);
  });

  // Record a human-reviewed fix & start verification period (SFA-FR-024, SFA-FR-025, SFA-NFR-005, SFA-NFR-006)
  app.post(
    '/api/incidents/:incidentId/fixes',
    requireAuth,
    requireRoles(['Developer', 'Administrator']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { incidentId } = req.params;
      const { fixSummary, selectedRecommendation, verificationWindowSec } = req.body as {
        fixSummary?: string;
        selectedRecommendation?: string;
        verificationWindowSec?: number;
      };

      const data = storeManager.getData();
      const incident = data.incidents.find((i) => i.id === incidentId);
      if (!incident) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }
      if (!fixSummary || !fixSummary.trim()) {
        res.status(400).json({ error: 'Fix description is required.' });
        return;
      }

      const appConfig = data.apps.find((a) => a.id === incident.appId);
      const prediction = data.predictions[incident.appId];
      const recentErrors = data.logs.filter(
        (l) =>
          l.appId === incident.appId &&
          (l.severity === 'ERROR' || l.severity === 'FATAL') &&
          Date.now() - Date.parse(l.timestamp) < 15 * 60_000
      ).length;

      const preFixSnapshot = captureSnapshot(
        incident.appId,
        prediction,
        data.metrics,
        recentErrors
      );

      const fixId = `FIX-${String(data.fixes.length + 101)}`;
      const fix: FixVerificationRecord = {
        id: fixId,
        incidentId: incident.id,
        appId: incident.appId,
        appliedBy: session.displayName,
        appliedAt: new Date().toISOString(),
        fixSummary: fixSummary.trim(),
        selectedRecommendation,
        verificationWindowSec:
          verificationWindowSec ?? appConfig?.thresholds.verificationWindowSec ?? 60,
        preFixSnapshot,
        verdict: 'Pending',
        verdictNotes: 'Post-fix verification window active. Collect or inject post-fix telemetry and run comparison.',
      };

      data.fixes.unshift(fix);
      incident.status = 'Mitigated';
      incident.latestFixId = fixId;
      incident.updatedAt = new Date().toISOString();

      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Recorded fix mitigation',
        'Fix',
        fixId,
        `Applied fix for ${incident.id} (pre-fix risk ${preFixSnapshot.riskScore}/100, window ${fix.verificationWindowSec}s).`
      );
      storeManager.save();

      res.status(201).json({ fix, incident });
    }
  );

  // Evaluate post-fix verification (SFA-FR-025..027)
  app.post(
    '/api/fixes/:fixId/verify',
    requireAuth,
    requireRoles(['Developer', 'Administrator', 'Tester']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      const { fixId } = req.params;
      const { simulateOutcome } = req.body as {
        simulateOutcome?: 'recovery' | 'regression' | 'current';
      };

      const data = storeManager.getData();
      const fixIdx = data.fixes.findIndex((f) => f.id === fixId);
      if (fixIdx === -1) {
        res.status(404).json({ error: 'Fix record not found.' });
        return;
      }
      const existingFix = data.fixes[fixIdx];

      // Optional controlled evaluation simulation for Tester/Developer verification
      if (simulateOutcome === 'recovery' || simulateOutcome === 'regression') {
        const scenario = generateScenarioPayload(
          simulateOutcome === 'recovery' ? 'post-fix-recovery' : 'post-fix-regression'
        );
        const parsed = parseLogBatch(existingFix.appId, scenario.rawLogs, 'post-fix-verifier');
        if (parsed.validEntries.length > 0) {
          data.logs = [...parsed.validEntries.reverse(), ...data.logs];
        }
        for (const m of scenario.metrics) {
          data.metrics.push({
            id: `met_${crypto.randomUUID().slice(0, 8)}`,
            appId: existingFix.appId,
            ...m,
          });
        }
        storeManager.recomputeAppAnalysis(existingFix.appId);
      } else {
        storeManager.recomputeAppAnalysis(existingFix.appId);
      }

      const prediction = data.predictions[existingFix.appId];
      const recentErrors = data.logs.filter(
        (l) =>
          l.appId === existingFix.appId &&
          (l.severity === 'ERROR' || l.severity === 'FATAL') &&
          Date.now() - Date.parse(l.timestamp) < 5 * 60_000
      ).length;

      const postSnapshot = captureSnapshot(
        existingFix.appId,
        prediction,
        data.metrics,
        recentErrors
      );

      const evaluated = evaluateFixVerification(existingFix, postSnapshot);
      data.fixes[fixIdx] = evaluated;

      const incident = data.incidents.find((i) => i.id === evaluated.incidentId);
      if (incident) {
        if (evaluated.verdict === 'Improved') {
          incident.status = 'Resolved';
          incident.resolvedAt = new Date().toISOString();
          incident.riskScore = postSnapshot.riskScore;
          incident.riskLevel = postSnapshot.riskLevel;
        } else if (evaluated.verdict === 'Became Worse') {
          incident.status = 'Investigating';
          incident.riskScore = postSnapshot.riskScore;
          incident.riskLevel = postSnapshot.riskLevel;
        }
        incident.updatedAt = new Date().toISOString();
      }

      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Completed post-fix verification',
        'Fix',
        evaluated.id,
        `Verdict: ${evaluated.verdict}. ${evaluated.verdictNotes}`
      );
      storeManager.save();

      res.json({ fix: evaluated, incident, prediction });
    }
  );

  // Audit logs (SFA-NFR-014)
  app.get('/api/audit-logs', requireAuth, (_req, res) => {
    const data = storeManager.getData();
    res.json({ auditLogs: data.auditLogs.slice(0, 120) });
  });

  // Reset demo data (Administrator / Tester)
  app.post(
    '/api/admin/reset-demo',
    requireAuth,
    requireRoles(['Administrator', 'Tester']),
    (req, res) => {
      const session = (req as express.Request & { session: SessionInfo }).session;
      storeManager.resetToSeed();
      storeManager.appendAudit(
        session.displayName,
        session.role,
        'Reset workspace baseline',
        'Application',
        'all',
        'Restored initial SRS sample applications, logs, and scenarios.'
      );
      storeManager.save();
      res.json({ ok: true });
    }
  );

  // Vite dev middleware or static dist serving
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Intelligent Software Failure Analyzer listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
