export interface SanitizationResult {
  sanitized: string;
  maskedCount: number;
}

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Bearer / JWT tokens
  {
    regex: /\b(Bearer\s+)[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]*/gi,
    replacement: '$1[REDACTED:JWT]',
  },
  {
    regex: /\b(Bearer\s+)[A-Za-z0-9\-._~+/]{16,}=*/gi,
    replacement: '$1[REDACTED:TOKEN]',
  },
  // Raw JWTs anywhere
  {
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:JWT]',
  },
  // Common provider API keys (Google, OpenAI, GitHub, AWS, Slack)
  {
    regex: /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
    replacement: '[REDACTED:API_KEY]',
  },
  {
    regex: /\bsk-[A-Za-z0-9]{16,}\b/g,
    replacement: '[REDACTED:API_KEY]',
  },
  {
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: '[REDACTED:TOKEN]',
  },
  {
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:AWS_KEY]',
  },
  // Connection string passwords: scheme://user:password@host
  {
    regex: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/g,
    replacement: '$1[REDACTED:DB_PASSWORD]$3',
  },
  // Key-value secrets in logs or JSON
  {
    regex: /(["']?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)["']?\s*[:=]\s*["']?)([^\s"',;}\]]{3,})(["']?)/gi,
    replacement: '$1[REDACTED:SECRET]$3',
  },
];

export function sanitizeSensitiveText(input: string): SanitizationResult {
  if (!input) {
    return { sanitized: input, maskedCount: 0 };
  }

  let output = input;
  let maskedCount = 0;

  for (const { regex, replacement } of SECRET_PATTERNS) {
    const matches = output.match(regex);
    if (matches && matches.length > 0) {
      maskedCount += matches.length;
      output = output.replace(regex, replacement);
    }
  }

  return { sanitized: output, maskedCount };
}

export function sanitizeForExternalAI(input: string): string {
  const { sanitized } = sanitizeSensitiveText(input);
  return sanitized
    // Mask email addresses and private internal IPv4 addresses before sending to external AI (SFA-NFR-015)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED:EMAIL]')
    .replace(/\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED:INTERNAL_IP]');
}
