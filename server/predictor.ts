import type {
  ErrorCluster,
  FailurePrediction,
  LogEntry,
  MonitoredApp,
  RiskFactor,
  RiskLevel,
  RuntimeMetricPoint,
} from './types.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function classifyRiskLevel(score: number, app: MonitoredApp): RiskLevel {
  if (score >= app.thresholds.criticalScore) return 'Critical';
  if (score >= app.thresholds.highRiskScore) return 'High Risk';
  if (score >= app.thresholds.warningScore) return 'Warning';
  return 'Normal';
}

function meanAndStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.max(Math.sqrt(variance), 0.5) };
}

export function calculateFailurePrediction(
  app: MonitoredApp,
  logs: LogEntry[],
  metrics: RuntimeMetricPoint[],
  clusters: ErrorCluster[]
): FailurePrediction {
  const appMetrics = metrics
    .filter((m) => m.appId === app.id)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const latest = appMetrics[appMetrics.length - 1] ?? {
    id: 'default',
    appId: app.id,
    timestamp: new Date().toISOString(),
    cpuPct: 22,
    memoryPct: 38,
    latencyP95Ms: 140,
    errorRatePct: 0.4,
    dbPoolPct: 30,
    requestsPerMin: 240,
  };

  const baselineSlice = appMetrics.length > 4 ? appMetrics.slice(0, -2) : appMetrics;
  const latencyStats = meanAndStd(baselineSlice.map((m) => m.latencyP95Ms));
  const errorStats = meanAndStd(baselineSlice.map((m) => m.errorRatePct));
  const memStats = meanAndStd(baselineSlice.map((m) => m.memoryPct));

  const latencyZ = (latest.latencyP95Ms - latencyStats.mean) / latencyStats.std;
  const errorZ = (latest.errorRatePct - errorStats.mean) / errorStats.std;
  const memZ = (latest.memoryPct - memStats.mean) / memStats.std;
  const maxZ = Math.round(Math.max(latencyZ, errorZ, memZ, 0) * 100) / 100;
  const anomalyDetected = maxZ >= 2.0;

  const appLogs = logs.filter((l) => l.appId === app.id);
  const recentErrors = appLogs.filter(
    (l) => l.severity === 'ERROR' || l.severity === 'FATAL'
  );
  const appClusters = clusters.filter((c) => c.appId === app.id);
  const topCluster = appClusters[0];

  const contributingFactors: RiskFactor[] = [];

  // 1. Error rate contribution (0 - 32 pts)
  const errRatio = latest.errorRatePct / Math.max(app.thresholds.maxErrorRatePct, 1);
  const errPts = Math.round(clamp(errRatio * 24 + (errorZ > 2 ? 8 : 0), 0, 32));
  contributingFactors.push({
    indicator: 'HTTP / Application Error Rate',
    currentValue: `${latest.errorRatePct.toFixed(2)}%`,
    baselineValue: `${errorStats.mean.toFixed(2)}% (limit ${app.thresholds.maxErrorRatePct}%)`,
    contributionPoints: errPts,
    status: errPts >= 24 ? 'Critical' : errPts >= 15 ? 'High Risk' : errPts >= 7 ? 'Warning' : 'Normal',
    explanation:
      errPts >= 15
        ? 'Sustained error rate acceleration indicates active request failures or cascading retries.'
        : 'Error rate remains within acceptable operating bounds.',
  });

  // 2. P95 Latency contribution (0 - 22 pts)
  const latRatio = latest.latencyP95Ms / Math.max(app.thresholds.maxLatencyMs, 100);
  const latPts = Math.round(clamp(latRatio * 16 + (latencyZ > 2 ? 6 : 0), 0, 22));
  contributingFactors.push({
    indicator: 'P95 Response Latency',
    currentValue: `${Math.round(latest.latencyP95Ms)} ms`,
    baselineValue: `${Math.round(latencyStats.mean)} ms (limit ${app.thresholds.maxLatencyMs} ms)`,
    contributionPoints: latPts,
    status: latPts >= 17 ? 'Critical' : latPts >= 11 ? 'High Risk' : latPts >= 6 ? 'Warning' : 'Normal',
    explanation:
      latPts >= 11
        ? `Tail latency jumped ${latencyZ.toFixed(1)}σ above baseline, signaling blocking I/O or thread contention.`
        : 'Response latency tracks close to historical baseline.',
  });

  // 3. Memory & CPU Resource Saturation (0 - 22 pts)
  const memRatio = latest.memoryPct / Math.max(app.thresholds.maxMemoryPct, 1);
  const cpuRatio = latest.cpuPct / Math.max(app.thresholds.maxCpuPct, 1);
  const resPts = Math.round(clamp(Math.max(memRatio, cpuRatio) * 18 + (memZ > 2 ? 4 : 0), 0, 22));
  contributingFactors.push({
    indicator: 'Memory & CPU Saturation',
    currentValue: `Mem ${latest.memoryPct.toFixed(0)}% / CPU ${latest.cpuPct.toFixed(0)}%`,
    baselineValue: `Limit ${app.thresholds.maxMemoryPct}% Mem / ${app.thresholds.maxCpuPct}% CPU`,
    contributionPoints: resPts,
    status: resPts >= 17 ? 'Critical' : resPts >= 12 ? 'High Risk' : resPts >= 6 ? 'Warning' : 'Normal',
    explanation:
      resPts >= 12
        ? 'Elevated memory or CPU pressure risks garbage-collection stalls or OOM worker restarts.'
        : 'Compute and heap headroom remain healthy.',
  });

  // 4. DB Connection Pool Pressure (0 - 14 pts)
  const dbPts = Math.round(clamp(((latest.dbPoolPct - 45) / 50) * 14, 0, 14));
  contributingFactors.push({
    indicator: 'Database Connection Pool Utilization',
    currentValue: `${latest.dbPoolPct.toFixed(0)}%`,
    baselineValue: 'Nominal < 65%',
    contributionPoints: dbPts,
    status: dbPts >= 11 ? 'Critical' : dbPts >= 7 ? 'High Risk' : dbPts >= 4 ? 'Warning' : 'Normal',
    explanation:
      dbPts >= 7
        ? 'Connection pool near saturation; incoming queries risk checkout timeouts.'
        : 'Database connection checkout capacity is adequate.',
  });

  // 5. Repeated Exception Cluster Burst (0 - 10 pts)
  const repeatCount = topCluster?.recentCount ?? recentErrors.length;
  const clusterPts = Math.round(clamp((repeatCount / 18) * 10, 0, 10));
  contributingFactors.push({
    indicator: 'Repeated Exception Cluster Frequency',
    currentValue: `${repeatCount} bursts / ${appClusters.length} cluster(s)`,
    baselineValue: '< 3 bursts per window',
    contributionPoints: clusterPts,
    status: clusterPts >= 8 ? 'Critical' : clusterPts >= 5 ? 'High Risk' : clusterPts >= 3 ? 'Warning' : 'Normal',
    explanation: topCluster
      ? `Dominant error pattern in ${topCluster.component}: "${topCluster.signature.slice(0, 75)}"`
      : 'No concentrated exception bursts detected.',
  });

  const rawScore = contributingFactors.reduce((sum, f) => sum + f.contributionPoints, 0);
  const riskScore = Math.round(clamp(rawScore, 0, 100));
  const riskLevel = classifyRiskLevel(riskScore, app);

  const affectedComponents = Array.from(
    new Set(appClusters.slice(0, 3).map((c) => c.component))
  );
  if (affectedComponents.length === 0 && app.components.length > 0) {
    affectedComponents.push(app.components[0]);
  }

  let probableFailureType = 'Nominal Operation';
  if (topCluster && riskScore >= app.thresholds.warningScore) {
    probableFailureType = topCluster.failureCategory;
  } else if (latest.dbPoolPct >= 82) {
    probableFailureType = 'Database Connection Pool Exhaustion';
  } else if (latest.memoryPct >= 85) {
    probableFailureType = 'Memory Pressure & Heap Exhaustion';
  } else if (latest.errorRatePct >= app.thresholds.maxErrorRatePct) {
    probableFailureType = 'HTTP 5xx Upstream / Gateway Cascade';
  }

  return {
    appId: app.id,
    calculatedAt: new Date().toISOString(),
    riskScore,
    riskLevel,
    anomalyDetected,
    anomalyZScore: maxZ,
    probableFailureType,
    affectedComponents,
    contributingFactors: contributingFactors.sort((a, b) => b.contributionPoints - a.contributionPoints),
    disclaimer:
      'Failure-risk score (0–100) is an estimate derived from rule-based thresholds and statistical anomaly indicators. It does not guarantee an exact crash time.',
  };
}
