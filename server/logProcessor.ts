import crypto from 'node:crypto';
import { sanitizeSensitiveText } from './sanitizer.ts';
import type { InvalidLogEntry, LogEntry, SeverityLevel } from './types.ts';

export interface ParsedBatchResult {
  validEntries: LogEntry[];
  invalidEntries: InvalidLogEntry[];
  totalLines: number;
  secretsMaskedCount: number;
  processingMs: number;
}

const VALID_SEVERITIES = new Set<SeverityLevel>(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

function normalizeSeverity(raw: unknown): SeverityLevel | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'WARNING') return 'WARN';
  if (upper === 'CRITICAL' || upper === 'CRIT' || upper === 'SEVERE') return 'FATAL';
  if (upper === 'ERR') return 'ERROR';
  if (VALID_SEVERITIES.has(upper as SeverityLevel)) {
    return upper as SeverityLevel;
  }
  return null;
}

function inferSeverityFromMessage(msg: string, httpStatus?: number): SeverityLevel {
  if (httpStatus && httpStatus >= 500) return 'ERROR';
  if (httpStatus && httpStatus >= 400) return 'WARN';
  const lower = msg.toLowerCase();
  if (lower.includes('fatal') || lower.includes('outofmemory') || lower.includes('panic')) return 'FATAL';
  if (lower.includes('error') || lower.includes('exception') || lower.includes('timeout') || lower.includes('failed')) return 'ERROR';
  if (lower.includes('warn') || lower.includes('retry') || lower.includes('slow')) return 'WARN';
  return 'INFO';
}

function inferComponent(rawMessage: string, source: string): string {
  const lower = `${rawMessage} ${source}`.toLowerCase();
  if (lower.includes('postgres') || lower.includes('pool') || lower.includes('sql') || lower.includes('db')) return 'db-pool';
  if (lower.includes('auth') || lower.includes('jwt') || lower.includes('token') || lower.includes('login')) return 'auth-service';
  if (lower.includes('payment') || lower.includes('stripe') || lower.includes('checkout')) return 'payment-gateway';
  if (lower.includes('cache') || lower.includes('redis')) return 'cache-layer';
  if (lower.includes('heap') || lower.includes('gc') || lower.includes('memory') || lower.includes('worker')) return 'worker-runtime';
  if (lower.includes('http') || lower.includes('upstream') || lower.includes('gateway') || lower.includes('nginx')) return 'api-gateway';
  return source || 'core-service';
}

function isStackContinuation(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('at ') ||
    trimmed.startsWith('Caused by:') ||
    trimmed.startsWith('Traceback (most recent call last)') ||
    trimmed.startsWith('File "') ||
    /^\s{2,}(at |raise |return |await )/.test(line)
  );
}

export function parseLogBatch(
  appId: string,
  rawInput: string,
  defaultSource = 'app-runtime'
): ParsedBatchResult {
  const start = performance.now();
  const lines = rawInput.split(/\r?\n/);
  const validEntries: LogEntry[] = [];
  const invalidEntries: InvalidLogEntry[] = [];
  let secretsMaskedCount = 0;
  const ingestedAt = new Date().toISOString();

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Attach stack-trace continuation lines to previous valid entry
    if (validEntries.length > 0 && isStackContinuation(rawLine)) {
      const { sanitized, maskedCount } = sanitizeSensitiveText(rawLine);
      secretsMaskedCount += maskedCount;
      const prev = validEntries[validEntries.length - 1];
      prev.stackTrace = prev.stackTrace ? `${prev.stackTrace}\n${sanitized}` : sanitized;
      prev.secretsMasked += maskedCount;
      continue;
    }

    // Reject control-character / binary garbage lines
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(trimmed)) {
      invalidEntries.push({
        lineNumber,
        rawSnippet: '[BINARY/CORRUPT_RECORD]',
        reason: 'Contains invalid non-printable control characters',
        timestamp: ingestedAt,
      });
      continue;
    }

    // 1. JSON log record
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const rawMsg = typeof parsed.message === 'string'
          ? parsed.message
          : typeof parsed.msg === 'string'
            ? parsed.msg
            : typeof parsed.error === 'string'
              ? parsed.error
              : '';
        if (!rawMsg.trim()) {
          const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
          invalidEntries.push({
            lineNumber,
            rawSnippet: sanitized,
            reason: 'JSON log record missing required "message" field',
            timestamp: ingestedAt,
          });
          continue;
        }

        const tsRaw = typeof parsed.timestamp === 'string' ? parsed.timestamp : typeof parsed.ts === 'string' ? parsed.ts : ingestedAt;
        const parsedDate = Date.parse(tsRaw);
        if (Number.isNaN(parsedDate)) {
          const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
          invalidEntries.push({
            lineNumber,
            rawSnippet: sanitized,
            reason: `Malformed ISO timestamp "${tsRaw}"`,
            timestamp: ingestedAt,
          });
          continue;
        }

        const httpStatus = typeof parsed.status === 'number'
          ? parsed.status
          : typeof parsed.httpStatus === 'number'
            ? parsed.httpStatus
            : undefined;

        const severity =
          normalizeSeverity(parsed.severity ?? parsed.level) ??
          inferSeverityFromMessage(rawMsg, httpStatus);

        const source = typeof parsed.source === 'string' && parsed.source.trim()
          ? parsed.source.trim()
          : defaultSource;

        const component = typeof parsed.component === 'string' && parsed.component.trim()
          ? parsed.component.trim()
          : inferComponent(rawMsg, source);

        const latencyMs = typeof parsed.latencyMs === 'number'
          ? parsed.latencyMs
          : typeof parsed.durationMs === 'number'
            ? parsed.durationMs
            : undefined;

        const msgClean = sanitizeSensitiveText(rawMsg);
        const stackRaw = typeof parsed.stack === 'string' ? parsed.stack : typeof parsed.stackTrace === 'string' ? parsed.stackTrace : undefined;
        const stackClean = stackRaw ? sanitizeSensitiveText(stackRaw) : undefined;
        const maskedTotal = msgClean.maskedCount + (stackClean?.maskedCount ?? 0);
        secretsMaskedCount += maskedTotal;

        validEntries.push({
          id: `log_${crypto.randomUUID().slice(0, 12)}`,
          appId,
          timestamp: new Date(parsedDate).toISOString(),
          severity,
          message: msgClean.sanitized,
          source,
          component,
          stackTrace: stackClean?.sanitized,
          httpStatus,
          latencyMs,
          secretsMasked: maskedTotal,
          ingestedAt,
        });
        continue;
      } catch {
        const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
        invalidEntries.push({
          lineNumber,
          rawSnippet: sanitized,
          reason: 'Malformed JSON syntax',
          timestamp: ingestedAt,
        });
        continue;
      }
    }

    // 2. Structured text log:
    // e.g., 2026-11-15T19:10:00Z [ERROR] [db-pool] Connection pool exhausted (latency=1420ms)
    // or    2026-11-15 19:10:00 ERROR api-gateway Upstream 503 Service Unavailable
    const structuredMatch = trimmed.match(
      /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+\[?(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\]?\s+(?:\[([a-zA-Z0-9._-]+)\]\s+)?(.+)$/i
    );

    if (structuredMatch) {
      const [, tsRaw, lvlRaw, compRaw, restMsg] = structuredMatch;
      const parsedDate = Date.parse(tsRaw);
      if (Number.isNaN(parsedDate)) {
        const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
        invalidEntries.push({
          lineNumber,
          rawSnippet: sanitized,
          reason: `Invalid timestamp "${tsRaw}"`,
          timestamp: ingestedAt,
        });
        continue;
      }

      const severity = normalizeSeverity(lvlRaw) ?? 'INFO';
      const latencyMatch = restMsg.match(/(?:latency|duration|time)[=:\s]+(\d+(?:\.\d+)?)\s*ms/i);
      const statusMatch = restMsg.match(/\bstatus[=:\s]+([45]\d{2})\b|\bHTTP\/\d\.\d["']?\s+([45]\d{2})\b/i);
      const latencyMs = latencyMatch ? Math.round(Number(latencyMatch[1])) : undefined;
      const httpStatus = statusMatch ? Number(statusMatch[1] || statusMatch[2]) : undefined;

      const msgClean = sanitizeSensitiveText(restMsg.trim());
      secretsMaskedCount += msgClean.maskedCount;
      const component = compRaw?.trim() || inferComponent(msgClean.sanitized, defaultSource);

      validEntries.push({
        id: `log_${crypto.randomUUID().slice(0, 12)}`,
        appId,
        timestamp: new Date(parsedDate).toISOString(),
        severity,
        message: msgClean.sanitized,
        source: defaultSource,
        component,
        httpStatus,
        latencyMs,
        secretsMasked: msgClean.maskedCount,
        ingestedAt,
      });
      continue;
    }

    // 3. Explicit invalid prefix or unrecognized corrupt lines
    if (
      trimmed.startsWith('INVALID_LOG') ||
      trimmed.startsWith('CORRUPT') ||
      trimmed.length < 6 ||
      !/[a-zA-Z]/.test(trimmed)
    ) {
      const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
      invalidEntries.push({
        lineNumber,
        rawSnippet: sanitized,
        reason: 'Unrecognized or incomplete log format (missing severity/message structure)',
        timestamp: ingestedAt,
      });
      continue;
    }

    // 4. Fallback plain text diagnostic line with recognizable level keyword
    const levelMatch = trimmed.match(/\b(FATAL|CRITICAL|ERROR|WARN|WARNING|INFO|DEBUG)\b[:\s-]*(.+)/i);
    if (levelMatch) {
      const severity = normalizeSeverity(levelMatch[1]) ?? 'INFO';
      const msgClean = sanitizeSensitiveText(levelMatch[2].trim());
      secretsMaskedCount += msgClean.maskedCount;
      validEntries.push({
        id: `log_${crypto.randomUUID().slice(0, 12)}`,
        appId,
        timestamp: ingestedAt,
        severity,
        message: msgClean.sanitized,
        source: defaultSource,
        component: inferComponent(msgClean.sanitized, defaultSource),
        secretsMasked: msgClean.maskedCount,
        ingestedAt,
      });
      continue;
    }

    // Reject lines without recognizable structure so SFA-FR-004 invalid-entry reporting works accurately
    const { sanitized } = sanitizeSensitiveText(trimmed.slice(0, 140));
    invalidEntries.push({
      lineNumber,
      rawSnippet: sanitized,
      reason: 'Missing timestamp or severity token in unstructured line',
      timestamp: ingestedAt,
    });
  }

  const processingMs = Math.round((performance.now() - start) * 100) / 100;
  return {
    validEntries,
    invalidEntries,
    totalLines: lines.filter((l) => l.trim().length > 0).length,
    secretsMaskedCount,
    processingMs,
  };
}
