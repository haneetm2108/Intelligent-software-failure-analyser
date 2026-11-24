import crypto from 'node:crypto';
import type { ErrorCluster, LogEntry, RuntimeMetricPoint, SeverityLevel } from './types.ts';

interface RcaRule {
  category: string;
  match: RegExp;
  probableCause: string;
  recommendations: string[];
}

const RCA_RULES: RcaRule[] = [
  {
    category: 'Database Connection Pool Exhaustion',
    match: /(pool exhausted|too many clients|econnrefused|connection timeout|deadlock|acquire.*connection|pg_bouncer|sqlstate)/i,
    probableCause:
      'Active database connections are exceeding the configured pool ceiling or queries are holding locks beyond the checkout timeout.',
    recommendations: [
      'Review slow SQL queries holding transactions open and add missing composite indexes.',
      'Configure connection pool max size, idleTimeoutMillis, and statement_timeout guardrails.',
      'Verify database replica health and connection-leak cleanup in finally blocks.',
    ],
  },
  {
    category: 'Memory Pressure & Heap Exhaustion',
    match: /(outofmemory|heap out of memory|enomem|gc overhead|allocation failed|memory threshold)/i,
    probableCause:
      'Unbounded in-memory caching, large payload buffering, or retained event listeners are preventing garbage collection from reclaiming heap space.',
    recommendations: [
      'Capture a heap snapshot during high memory slope to identify retained object graphs.',
      'Bound in-memory LRU caches with explicit max-entry and TTL limits.',
      'Stream large batch payloads rather than buffering entire responses in memory.',
    ],
  },
  {
    category: 'HTTP 5xx Upstream / Gateway Cascade',
    match: /(502|503|504|upstream timed out|socket hang up|circuit breaker|service unavailable|bad gateway|econnreset)/i,
    probableCause:
      'Downstream dependency latency exceeded gateway timeouts, triggering aggressive client retries that amplified request saturation.',
    recommendations: [
      'Enable exponential backoff with jitter on upstream HTTP client retries.',
      'Apply circuit-breaker isolation and tighter per-route timeout budgets.',
      'Inspect downstream service CPU saturation and queue depth during peak load.',
    ],
  },
  {
    category: 'Authentication & Token Verification Failure',
    match: /(jwt expired|invalid signature|unauthorized|401|403|token.*revoked|permission denied|auth.*failed)/i,
    probableCause:
      'Expired signing keys, clock skew across service replicas, or malformed bearer credentials are causing repeated authorization rejections.',
    recommendations: [
      'Verify JWKS key rotation sync and NTP clock alignment across auth workers.',
      'Ensure client refresh-token rotation handles concurrent requests safely.',
      'Audit recent RBAC policy or scope configuration changes.',
    ],
  },
  {
    category: 'Unhandled Exception / Null Dereference',
    match: /(nullpointer|cannot read properties|undefined is not|typeerror|keyerror|unhandledpromiserejection|referenceerror)/i,
    probableCause:
      'Unexpected missing or malformed fields in upstream payloads bypassed input validation and triggered unhandled runtime exceptions.',
    recommendations: [
      'Add strict schema validation (e.g., Zod/Pydantic) at API ingress boundaries.',
      'Guard optional nested property lookups and provide safe fallback defaults.',
      'Add regression unit tests reproducing the exact malformed payload.',
    ],
  },
  {
    category: 'Disk & File Descriptor Saturation',
    match: /(enospc|no space left|emfile|too many open files|i\/o timeout|disk full)/i,
    probableCause:
      'Log rotation backlog, unclosed file handles, or temporary artifact buildup exhausted local disk or file-descriptor quotas.',
    recommendations: [
      'Configure log rotation and retention caps on temporary scratch volumes.',
      'Verify file streams and socket descriptors are explicitly closed on error paths.',
      'Expand volume quota or offload artifacts to object storage.',
    ],
  },
];

export function normalizeErrorSignature(message: string): string {
  return message
    // Replace UUIDs
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    // Replace ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TS>')
    // Replace IP addresses
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<IP>')
    // Replace hex literals
    .replace(/\b0x[0-9a-f]+\b/gi, '<HEX>')
    // Replace latencies/numbers
    .replace(/\b\d+(?:\.\d+)?\s*ms\b/gi, '<MS>')
    .replace(/\b\d{2,}\b/g, '<NUM>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function classifyRule(text: string): RcaRule {
  for (const rule of RCA_RULES) {
    if (rule.match.test(text)) {
      return rule;
    }
  }
  return {
    category: 'Application Runtime Error',
    match: /.*/,
    probableCause:
      'Recurring error events were observed in this component; correlate stack frames with recent deployment or configuration changes.',
    recommendations: [
      'Inspect the latest stack trace frames and verify inputs entering the affected component.',
      'Compare recent dependency or configuration diffs prior to the first error timestamp.',
      'Add targeted structured logging around the failing operation before deploying a patch.',
    ],
  };
}

function severityRank(sev: SeverityLevel): number {
  switch (sev) {
    case 'FATAL':
      return 5;
    case 'ERROR':
      return 4;
    case 'WARN':
      return 3;
    case 'INFO':
      return 2;
    default:
      return 1;
  }
}

export function buildErrorClusters(
  appId: string,
  logs: LogEntry[],
  metrics: RuntimeMetricPoint[],
  existingClusters: ErrorCluster[]
): ErrorCluster[] {
  const existingMap = new Map<string, ErrorCluster>();
  for (const c of existingClusters) {
    if (c.appId === appId) {
      existingMap.set(`${c.component}::${c.signature}`, c);
    }
  }

  const errorLogs = logs.filter(
    (l) => l.appId === appId && (l.severity === 'ERROR' || l.severity === 'FATAL' || (l.severity === 'WARN' && (l.httpStatus ?? 0) >= 400))
  );

  const grouped = new Map<string, LogEntry[]>();
  for (const entry of errorLogs) {
    const sig = normalizeErrorSignature(entry.message);
    const key = `${entry.component}::${sig}`;
    const list = grouped.get(key);
    if (list) {
      list.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }

  const latestMetric = metrics
    .filter((m) => m.appId === appId)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const result: ErrorCluster[] = [];

  for (const [key, items] of grouped.entries()) {
    items.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const sample = items[items.length - 1];
    const first = items[0];
    const prev = existingMap.get(key);
    const signature = normalizeErrorSignature(sample.message);
    const combinedText = `${sample.message}\n${sample.stackTrace ?? ''}`;
    const rule = classifyRule(combinedText);

    const highestSev = items.reduce<SeverityLevel>(
      (acc, cur) => (severityRank(cur.severity) > severityRank(acc) ? cur.severity : acc),
      sample.severity
    );

    const recentCount = items.filter((i) => Date.parse(i.timestamp) >= recentCutoff).length;

    const evidence: string[] = [
      `Observed ${items.length} matching error event(s) in component "${sample.component}" (${recentCount} in the last 15 min).`,
      `Latest log [${sample.severity}] @ ${sample.timestamp}: ${sample.message}`,
    ];
    if (sample.stackTrace) {
      const firstFrames = sample.stackTrace.split('\n').slice(0, 3).join(' | ');
      evidence.push(`Stack trace frame: ${firstFrames}`);
    }
    if (latestMetric) {
      if (latestMetric.dbPoolPct >= 80) {
        evidence.push(`Correlated telemetry: DB connection pool saturation at ${latestMetric.dbPoolPct.toFixed(1)}%.`);
      }
      if (latestMetric.memoryPct >= 80) {
        evidence.push(`Correlated telemetry: Memory utilization elevated at ${latestMetric.memoryPct.toFixed(1)}%.`);
      }
      if (latestMetric.latencyP95Ms >= 700) {
        evidence.push(`Correlated telemetry: P95 latency spiked to ${latestMetric.latencyP95Ms} ms.`);
      }
      if (latestMetric.errorRatePct >= 4) {
        evidence.push(`Correlated telemetry: Application error rate at ${latestMetric.errorRatePct.toFixed(2)}%.`);
      }
    }

    result.push({
      id: prev?.id ?? `cls_${crypto.randomUUID().slice(0, 10)}`,
      appId,
      signature,
      sampleMessage: sample.message,
      component: sample.component,
      severity: highestSev,
      count: items.length,
      recentCount,
      firstSeen: first.timestamp,
      lastSeen: sample.timestamp,
      sampleStackTrace: items.find((i) => i.stackTrace)?.stackTrace,
      failureCategory: rule.category,
      probableCause: rule.probableCause,
      confirmedCause: prev?.confirmedCause,
      causeStatus: prev?.causeStatus ?? 'Probable',
      confirmedBy: prev?.confirmedBy,
      confirmedAt: prev?.confirmedAt,
      evidence,
      recommendations: rule.recommendations,
    });
  }

  return result.sort((a, b) => b.count - a.count || Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}
