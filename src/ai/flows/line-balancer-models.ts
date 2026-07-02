const DEFAULT_PRIMARY_MODEL = 'googleai/gemini-3.5-flash';
const DEFAULT_FALLBACK_MODEL = 'googleai/gemini-3-flash-preview';

type ModelChainOptions = {
  configuredModels?: string;
  primaryModel?: string;
  fallbackModel?: string;
};

export const normalizeGoogleAiModelName = (model: string) => {
  const trimmed = model.trim();
  if (!trimmed) return '';
  return trimmed.includes('/') ? trimmed : `googleai/${trimmed}`;
};

export function buildLineBalancerModelChain(options: ModelChainOptions = {}) {
  const configuredModels = options.configuredModels?.trim();
  const rawModels = configuredModels
    ? configuredModels.split(',')
    : [
      options.primaryModel || DEFAULT_PRIMARY_MODEL,
      options.fallbackModel || DEFAULT_FALLBACK_MODEL,
    ];

  return Array.from(new Set(
    rawModels
      .map(normalizeGoogleAiModelName)
      .filter(Boolean)
  ));
}

export function getLineBalancerModelChain() {
  return buildLineBalancerModelChain({
    configuredModels: process.env.GEMINI_LINE_BALANCER_MODELS,
    primaryModel: process.env.GEMINI_LINE_BALANCER_MODEL,
    fallbackModel: process.env.GEMINI_LINE_BALANCER_FALLBACK_MODEL,
  });
}
