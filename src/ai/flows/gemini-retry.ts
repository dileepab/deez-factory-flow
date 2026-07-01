const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE_PATTERNS = [
  /\b503\b/i,
  /\bservice unavailable\b/i,
  /\bunavailable\b/i,
  /\bhigh demand\b/i,
  /\boverloaded\b/i,
  /\btemporarily unavailable\b/i,
  /\bresource exhausted\b/i,
  /\brate limit(?:ed)?\b/i,
  /\btoo many requests\b/i,
  /\bdeadline exceeded\b/i,
  /\btimeout\b/i,
  /\betimedout\b/i,
  /\beconnreset\b/i,
] as const;

export const AI_RETRY_EXHAUSTED_MESSAGE =
  'AI planning is temporarily busy after several retries. Please try AI Balance Line again in a few minutes.';

type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (details: {
    attempt: number;
    nextAttempt: number;
    maxAttempts: number;
    delayMs: number;
    error: unknown;
  }) => void;
  shouldRetry?: (error: unknown) => boolean;
};

const defaultSleep = (delayMs: number) =>
  new Promise<void>(resolve => setTimeout(resolve, delayMs));

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;

  const candidates = [
    (error as { status?: unknown }).status,
    (error as { statusCode?: unknown }).statusCode,
    (error as { code?: unknown }).code,
    (error as { response?: { status?: unknown } }).response?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'string') {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
};

export const getAiErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    const details = [
      error.name,
      error.message,
      (error as Error & { code?: unknown }).code,
      (error as Error & { status?: unknown }).status,
      (error as Error & { details?: unknown }).details,
    ].filter(Boolean);
    return details.map(String).join(' ');
  }

  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const isRetryableGeminiError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status !== null && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  const text = getAiErrorText(error);
  return RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(text));
};

export const getRetryableAiErrorMessage = (error: unknown): string | null =>
  isRetryableGeminiError(error) ? AI_RETRY_EXHAUSTED_MESSAGE : null;

export const calculateRetryDelayMs = (
  attempt: number,
  baseDelayMs = 750,
  maxDelayMs = 6000,
  jitterRatio = 0.2
) => {
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitterWindow = exponentialDelay * Math.max(0, jitterRatio);
  const jitter = jitterWindow > 0 ? Math.random() * jitterWindow : 0;
  return Math.round(exponentialDelay + jitter);
};

export async function runWithGeminiRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? isRetryableGeminiError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delayMs = calculateRetryDelayMs(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs,
        options.jitterRatio
      );
      options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
