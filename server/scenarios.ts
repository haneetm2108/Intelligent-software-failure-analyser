import type { RuntimeMetricPoint } from './types.ts';

export type ScenarioId =
  | 'db-pool-exhaustion'
  | 'memory-leak-oom'
  | 'http-5xx-cascade'
  | 'benchmark-10k'
  | 'post-fix-recovery'
  | 'post-fix-regression';

export interface GeneratedScenarioPayload {
  name: string;
  description: string;
  rawLogs: string;
  metrics: Omit<RuntimeMetricPoint, 'id' | 'appId'>[];
}

export function generateScenarioPayload(scenarioId: ScenarioId): GeneratedScenarioPayload {
  const now = Date.now();
  const ts = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  switch (scenarioId) {
    case 'db-pool-exhaustion': {
      const lines = [
        `${ts(-90_000)} [WARN] [db-pool] Query wait queue depth reached 14 waiting tasks (latency=680ms)`,
        `${ts(-70_000)} [ERROR] [db-pool] Connection pool exhausted after 5000ms timeout on postgres://svc_app:SuperSecretPass99@db-primary:5432/appdb`,
        `  at Pool.acquire (src/db/pool.ts:118:15)`,
        `  at OrderRepo.create (src/repos/order.ts:62:19)`,
        `${ts(-50_000)} [ERROR] [db-pool] Connection pool exhausted after 5000ms timeout on postgres://svc_app:SuperSecretPass99@db-primary:5432/appdb`,
        `${ts(-30_000)} [ERROR] [db-pool] Connection pool exhausted after 5000ms timeout on postgres://svc_app:SuperSecretPass99@db-primary:5432/appdb`,
        `${ts(-20_000)} [FATAL] [api-gateway] HTTP 503 Service Unavailable returned on POST /api/orders status=503 latency=5024ms`,
        `INVALID_MALFORMED_LINE_CORRUPT_HEADER`,
      ];
      return {
        name: 'Database Connection Pool Exhaustion',
        description: 'Simulates lock contention, connection checkout timeouts, and cascading 503 responses.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-60_000), cpuPct: 68, memoryPct: 66, latencyP95Ms: 840, errorRatePct: 4.8, dbPoolPct: 91, requestsPerMin: 560 },
          { timestamp: ts(-30_000), cpuPct: 74, memoryPct: 69, latencyP95Ms: 1180, errorRatePct: 6.4, dbPoolPct: 96, requestsPerMin: 595 },
          { timestamp: ts(-5_000), cpuPct: 79, memoryPct: 71, latencyP95Ms: 1490, errorRatePct: 8.2, dbPoolPct: 99, requestsPerMin: 610 },
        ],
      };
    }

    case 'memory-leak-oom': {
      const lines = [
        `${ts(-80_000)} [WARN] [worker-runtime] Heap utilization crossed 83% (1690MB / 2048MB); major GC pause 410ms`,
        `${ts(-60_000)} [WARN] [worker-runtime] Retained buffer cache entries grew to 48000 items (latency=790ms)`,
        `${ts(-40_000)} [ERROR] [worker-runtime] JavaScript heap out of memory allocation failed during report export`,
        `  at ArrayBuffer.alloc (src/workers/pdfExport.ts:204:12)`,
        `  at ReportQueue.processJob (src/workers/queue.ts:87:9)`,
        `${ts(-20_000)} [FATAL] [worker-runtime] OutOfMemoryError: worker process restarting after GC overhead limit exceeded`,
      ];
      return {
        name: 'Memory Leak & Heap Exhaustion',
        description: 'Simulates steady memory growth, GC pauses, and OutOfMemoryError worker failures.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-60_000), cpuPct: 62, memoryPct: 84, latencyP95Ms: 620, errorRatePct: 2.9, dbPoolPct: 45, requestsPerMin: 210 },
          { timestamp: ts(-30_000), cpuPct: 74, memoryPct: 91, latencyP95Ms: 890, errorRatePct: 4.7, dbPoolPct: 47, requestsPerMin: 205 },
          { timestamp: ts(-5_000), cpuPct: 86, memoryPct: 96, latencyP95Ms: 1240, errorRatePct: 7.5, dbPoolPct: 48, requestsPerMin: 185 },
        ],
      };
    }

    case 'http-5xx-cascade': {
      const lines = [
        `${ts(-75_000)} [WARN] [api-gateway] Upstream payment-partner latency elevated (latency=920ms) with token api_key=sk-testSecretKey9988776655443322`,
        `${ts(-55_000)} [ERROR] [api-gateway] Upstream 502 Bad Gateway on POST /api/checkout status=502 latency=1420ms`,
        `  at ProxyClient.forward (src/gateway/proxy.ts:94:18)`,
        `${ts(-35_000)} [ERROR] [api-gateway] Upstream 504 Gateway Timeout on POST /api/checkout status=504 latency=2010ms`,
        `${ts(-15_000)} [ERROR] [api-gateway] Circuit breaker HALF-OPEN failed; returning 503 Service Unavailable status=503 latency=2045ms`,
      ];
      return {
        name: 'HTTP 5xx Upstream Cascade',
        description: 'Simulates downstream gateway timeouts and retry storms across API endpoints.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-60_000), cpuPct: 64, memoryPct: 58, latencyP95Ms: 920, errorRatePct: 4.5, dbPoolPct: 52, requestsPerMin: 480 },
          { timestamp: ts(-30_000), cpuPct: 78, memoryPct: 62, latencyP95Ms: 1380, errorRatePct: 7.8, dbPoolPct: 55, requestsPerMin: 530 },
          { timestamp: ts(-5_000), cpuPct: 84, memoryPct: 64, latencyP95Ms: 1790, errorRatePct: 10.4, dbPoolPct: 58, requestsPerMin: 575 },
        ],
      };
    }

    case 'benchmark-10k': {
      // Generates exactly 10,000 log records: 9,850 valid (including masked secrets) + 150 invalid lines (SFA-NFR-001 + SFA-FR-004 + SFA-NFR-011)
      const lines: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        if (i % 67 === 0) {
          lines.push(`CORRUPT_UNSTRUCTURED_RECORD_${i}`);
        } else if (i % 200 === 0) {
          lines.push(
            JSON.stringify({
              timestamp: ts(-(10_000 - i) * 5),
              level: 'ERROR',
              component: 'db-pool',
              source: 'bench-runner',
              message: `Connection pool exhausted on attempt #${i} using token Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sig123456`,
              latencyMs: 1250 + (i % 300),
              status: 503,
            })
          );
        } else if (i % 120 === 0) {
          lines.push(
            `${ts(-(10_000 - i) * 5)} [WARN] [api-gateway] Elevated upstream response latency=${420 + (i % 150)}ms`
          );
        } else {
          lines.push(
            `${ts(-(10_000 - i) * 5)} [INFO] [api-gateway] Request handled id=${i} latency=${35 + (i % 45)}ms`
          );
        }
      }
      return {
        name: '10,000-Record Performance Benchmark (SFA-NFR-001)',
        description:
          'Generates 10,000 mixed JSON & structured logs including 150 malformed lines and embedded secrets to verify <10s ingestion, partial-error resilience, and secret masking.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-10_000), cpuPct: 58, memoryPct: 62, latencyP95Ms: 490, errorRatePct: 2.6, dbPoolPct: 72, requestsPerMin: 980 },
        ],
      };
    }

    case 'post-fix-recovery': {
      const lines = [
        `${ts(-20_000)} [INFO] [db-pool] Pool size tuned to 80 with idleTimeoutMillis=15000; active connections=18/80`,
        `${ts(-10_000)} [INFO] [api-gateway] Health check passed status=200 latency=68ms`,
        `${ts(-4_000)} [INFO] [api-gateway] Request throughput nominal status=200 latency=74ms`,
      ];
      return {
        name: 'Post-Fix Healthy Telemetry',
        description: 'Simulates healthy post-mitigation telemetry so fix verification can evaluate improvement.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-15_000), cpuPct: 31, memoryPct: 46, latencyP95Ms: 145, errorRatePct: 0.35, dbPoolPct: 32, requestsPerMin: 440 },
          { timestamp: ts(-5_000), cpuPct: 27, memoryPct: 44, latencyP95Ms: 118, errorRatePct: 0.2, dbPoolPct: 28, requestsPerMin: 455 },
        ],
      };
    }

    case 'post-fix-regression': {
      const lines = [
        `${ts(-12_000)} [ERROR] [db-pool] Connection pool exhausted again after config reload (active=80/80, waiting=31)`,
        `${ts(-5_000)} [FATAL] [api-gateway] HTTP 503 surge post-deploy status=503 latency=3200ms`,
      ];
      return {
        name: 'Post-Fix Regression Telemetry',
        description: 'Simulates worsening metrics after an ineffective fix to validate "Became Worse" detection.',
        rawLogs: lines.join('\n'),
        metrics: [
          { timestamp: ts(-5_000), cpuPct: 91, memoryPct: 89, latencyP95Ms: 1940, errorRatePct: 12.4, dbPoolPct: 99, requestsPerMin: 640 },
        ],
      };
    }
  }
}
