import { describe, expect, it } from 'vitest';
import {
  buildLineBalancerModelChain,
  normalizeGoogleAiModelName,
} from './line-balancer-models';

describe('line balancer model chain', () => {
  it('defaults to Gemini 3.5 Flash then Gemini 3 Flash Preview', () => {
    expect(buildLineBalancerModelChain()).toEqual([
      'googleai/gemini-3.5-flash',
      'googleai/gemini-3-flash-preview',
    ]);
  });

  it('normalizes bare Gemini model names for the Google AI Genkit plugin', () => {
    expect(normalizeGoogleAiModelName('gemini-3-flash-preview')).toBe('googleai/gemini-3-flash-preview');
    expect(normalizeGoogleAiModelName('googleai/gemini-3.5-flash')).toBe('googleai/gemini-3.5-flash');
  });

  it('allows a comma-separated production model chain override', () => {
    expect(buildLineBalancerModelChain({
      configuredModels: 'gemini-3-flash-preview, googleai/gemini-3.1-flash-lite, gemini-3-flash-preview',
    })).toEqual([
      'googleai/gemini-3-flash-preview',
      'googleai/gemini-3.1-flash-lite',
    ]);
  });
});
