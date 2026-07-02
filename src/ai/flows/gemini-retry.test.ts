import { describe, expect, it, vi } from 'vitest';
import {
  AI_RETRY_EXHAUSTED_MESSAGE,
  getRetryableAiErrorMessage,
  isGeminiQuotaExceededError,
  isRetryableGeminiError,
  runWithGeminiRetry,
} from './gemini-retry';

describe('gemini retry helper', () => {
  it('retries transient Gemini capacity errors with exponential backoff', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('[503 Service Unavailable] high demand'), { status: 503 }))
      .mockRejectedValueOnce(new Error('UNAVAILABLE: model overloaded'))
      .mockResolvedValue('balanced');
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(runWithGeminiRetry(operation, {
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitterRatio: 0,
      sleep,
      onRetry,
    })).resolves.toBe('balanced');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stops retrying after the configured attempt limit', async () => {
    const error = Object.assign(new Error('Service Unavailable'), { status: 503 });
    const operation = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runWithGeminiRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 25,
      jitterRatio: 0,
      sleep,
    })).rejects.toThrow('Service Unavailable');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient errors', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('Invalid API key'), { status: 401 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(runWithGeminiRetry(operation, { sleep })).rejects.toThrow('Invalid API key');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('recognizes high-demand and overloaded messages as retryable', () => {
    expect(isRetryableGeminiError(new Error('This model is currently experiencing high demand.'))).toBe(true);
    expect(isRetryableGeminiError(new Error('The service is overloaded, please try again later.'))).toBe(true);
    expect(getRetryableAiErrorMessage(new Error('UNAVAILABLE'))).toBe(AI_RETRY_EXHAUSTED_MESSAGE);
  });

  it('recognizes hard quota exhaustion separately from generic retryable errors', () => {
    expect(isGeminiQuotaExceededError(new Error('You exceeded your current quota.'))).toBe(true);
    expect(isGeminiQuotaExceededError(new Error('Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests'))).toBe(true);
    expect(isGeminiQuotaExceededError(new Error('This model is currently experiencing high demand.'))).toBe(false);
  });
});
