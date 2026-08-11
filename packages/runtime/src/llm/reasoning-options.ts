/**
 * Model-specific providerOptions for reasoning-enabled models.
 * Shapes follow the AI SDK openai-compatible provider namespace.
 *
 * Zen spike (2026-08-09): laguna-s-2.1-free accepts both `reasoning_effort`
 * and `reasoning: { effort }` at the HTTP level. north-mini-code-free returned
 * upstream 401 (provider auth), so field-name validation was inconclusive for
 * that model — AI SDK maps `openai.reasoningEffort` to the provider shape.
 */
const REASONING_MODEL_PATTERNS: Array<{
  match: RegExp;
  options: Record<string, unknown>;
}> = [
  {
    // Kimi K3: preserved thinking, effort configurable
    match: /^kimi-k3$/i,
    options: {
      openai: { reasoningEffort: 'high' },
    },
  },
  {
    match: /^moonshotai\/kimi-k3$/i,
    options: {
      openai: { reasoningEffort: 'high' },
    },
  },
  {
    // Cohere North Mini Code: interleaved reasoning
    match: /^north-mini-code/i,
    options: {
      openai: { reasoningEffort: 'medium' },
    },
  },
  {
    // Poolside Laguna: native reasoning (off/max on direct API; Zen may ignore)
    match: /^laguna-s/i,
    options: {
      openai: { reasoningEffort: 'high' },
    },
  },
  {
    // Inkling: controllable effort, reasoning on by default
    match: /^thinkingmachines\/inkling/i,
    options: {
      openai: { reasoningEffort: 'high' },
    },
  },
];

export function reasoningProviderOptions(
  modelId: string,
): Record<string, unknown> | undefined {
  const id = modelId.trim();
  for (const { match, options } of REASONING_MODEL_PATTERNS) {
    if (match.test(id)) return options;
  }
  return undefined;
}

/** Merge anthropic cache breakpoint options with model-specific reasoning options. */
export function mergeProviderOptions(
  modelId: string,
): Record<string, unknown> | undefined {
  const reasoning = reasoningProviderOptions(modelId);
  const anthropic = { cacheControl: { type: 'ephemeral' as const } };
  if (!reasoning) {
    return { anthropic };
  }
  return {
    anthropic,
    ...reasoning,
  };
}
