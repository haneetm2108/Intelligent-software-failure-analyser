import crypto from 'node:crypto';
import type {
  AlertRecord,
  ErrorCluster,
  FailurePrediction,
  FixVerificationRecord,
  IncidentRecord,
  MetricSnapshot,
  MonitoredApp,
  RuntimeMetricPoint,
  StoreData,
  VerificationVerdict,
} from './types.ts';

export function captureSnapshot(
  appId: string,
  prediction: FailurePrediction,
  metrics: RuntimeMetricPoint[],
  errorCountWindow: number
): MetricSnapshot {
  const latest = metrics
    .filter((m) => m.appId === appId)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

  return {
    capturedAt: new Date().toISOString(),
    riskScore: prediction.riskScore,
    riskLevel: prediction.riskLevel,
    errorRatePct: latest?.errorRatePct ?? 0,
    latencyP95Ms: latest?.latencyP95Ms ?? 0,
    cpuPct: latest?.cpuPct ?? 0,
    memoryPct: latest?.memoryPct ?? 0,
    dbPoolPct: latest?.dbPoolPct ?? 0,
    errorCountWindow,
  };
}

export function evaluateAlertsAndIncidents(
  store: StoreData,
  app: MonitoredApp,
  prediction: FailurePrediction,
  appClusters: ErrorCluster[]
): { newAlert?: AlertRecord; newIncident?: IncidentRecord } {
  const topCluster = appClusters[0];
  let newAlert: AlertRecord | undefined;
  let newIncident: IncidentRecord | undefined;

  if (prediction.riskScore >= app.thresholds.alertTriggerScore) {
    const recentUnackedAlert = store.alerts.find(
      (a) =>
        a.appId === app.id &&
        !a.acknowledged &&
        a.probableFailureType === prediction.probableFailureType &&
        Date.now() - Date.parse(a.timestamp) < 10 * 60 * 1000
    );

    const existingOpenIncident = store.incidents.find(
      (inc) =>
        inc.appId === app.id &&
        inc.status !== 'Resolved' &&
        inc.failureCategory === prediction.probableFailureType
    );

    let incidentId = existingOpenIncident?.id;

    if (!existingOpenIncident) {
      incidentId = `INC-${String(store.incidents.length + 101)}`;
      newIncident = {
        id: incidentId,
        appId: app.id,
        appName: app.name,
        title: `${prediction.probableFailureType} detected on ${topCluster?.component ?? prediction.affectedComponents[0] ?? 'core-service'}`,
        component: topCluster?.component ?? prediction.affectedComponents[0] ?? 'core-service',
        severity: topCluster?.severity ?? (prediction.riskLevel === 'Critical' ? 'FATAL' : 'ERROR'),
        riskScore: prediction.riskScore,
        riskLevel: prediction.riskLevel,
        status: 'Open',
        clusterId: topCluster?.id,
        failureCategory: prediction.probableFailureType,
        probableCause:
          topCluster?.probableCause ??
          'Multiple runtime indicators crossed configured failure-risk thresholds simultaneously.',
        confirmedCause: topCluster?.confirmedCause,
        causeStatus: topCluster?.causeStatus ?? 'Probable',
        evidence:
          topCluster?.evidence ??
          prediction.contributingFactors
            .filter((f) => f.contributionPoints >= 8)
            .map((f) => `${f.indicator}: ${f.currentValue} (${f.explanation})`),
        recommendations:
          topCluster?.recommendations ?? [
            'Inspect active resource consumption and recent error logs for the affected component.',
            'Review recent deployment or configuration updates before applying mitigation.',
          ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.incidents.unshift(newIncident);
    } else {
      // Refresh existing active incident metrics & evidence
      existingOpenIncident.riskScore = prediction.riskScore;
      existingOpenIncident.riskLevel = prediction.riskLevel;
      existingOpenIncident.updatedAt = new Date().toISOString();
      if (topCluster) {
        existingOpenIncident.evidence = topCluster.evidence;
        existingOpenIncident.clusterId = topCluster.id;
      }
    }

    if (!recentUnackedAlert) {
      const majorIndicators = prediction.contributingFactors
        .filter((f) => f.contributionPoints >= 8)
        .slice(0, 3)
        .map((f) => `${f.indicator}: ${f.currentValue}`);

      newAlert = {
        id: `ALT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        appId: app.id,
        appName: app.name,
        timestamp: new Date().toISOString(),
        riskScore: prediction.riskScore,
        riskLevel: prediction.riskLevel,
        majorIndicators: majorIndicators.length > 0 ? majorIndicators : ['Risk threshold exceeded'],
        probableFailureType: prediction.probableFailureType,
        acknowledged: false,
        incidentId,
      };
      store.alerts.unshift(newAlert);
    }
  }

  return { newAlert, newIncident };
}

export function evaluateFixVerification(
  fix: FixVerificationRecord,
  postSnapshot: MetricSnapshot
): FixVerificationRecord {
  const pre = fix.preFixSnapshot;
  const riskScoreDelta = Math.round((postSnapshot.riskScore - pre.riskScore) * 10) / 10;
  const errorRateDelta = Math.round((postSnapshot.errorRatePct - pre.errorRatePct) * 100) / 100;
  const latencyDelta = Math.round(postSnapshot.latencyP95Ms - pre.latencyP95Ms);
  const memoryDelta = Math.round((postSnapshot.memoryPct - pre.memoryPct) * 10) / 10;
  const cpuDelta = Math.round((postSnapshot.cpuPct - pre.cpuPct) * 10) / 10;

  let verdict: VerificationVerdict = 'Stayed Similar';
  let verdictNotes = '';

  if (
    riskScoreDelta <= -15 ||
    (errorRateDelta <= -1.5 && riskScoreDelta <= -8) ||
    (latencyDelta <= -200 && riskScoreDelta <= -8)
  ) {
    verdict = 'Improved';
    verdictNotes = `Failure risk dropped by ${Math.abs(riskScoreDelta)} points (${pre.riskScore} → ${postSnapshot.riskScore}), error rate changed by ${errorRateDelta}%, and P95 latency changed by ${latencyDelta} ms.`;
  } else if (
    riskScoreDelta >= 10 ||
    errorRateDelta >= 1.5 ||
    latencyDelta >= 250
  ) {
    verdict = 'Became Worse';
    verdictNotes = `Regression detected after fix: risk score increased by +${riskScoreDelta} points (${pre.riskScore} → ${postSnapshot.riskScore}). Rollback or additional investigation recommended.`;
  } else {
    verdict = 'Stayed Similar';
    verdictNotes = `Post-fix indicators show minimal net shift (risk delta ${riskScoreDelta >= 0 ? '+' : ''}${riskScoreDelta} pts, error rate delta ${errorRateDelta >= 0 ? '+' : ''}${errorRateDelta}%). Continue monitoring or verify fix deployment.`;
  }

  return {
    ...fix,
    postFixSnapshot: postSnapshot,
    verdict,
    verdictNotes,
    deltas: {
      riskScoreDelta,
      errorRateDelta,
      latencyDelta,
      memoryDelta,
      cpuDelta,
    },
  };
}
