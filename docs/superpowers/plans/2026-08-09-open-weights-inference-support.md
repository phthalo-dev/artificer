# Open-Weights Inference Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class support for Poolside, Cohere North Mini Code, Kimi K3, Inkling, and Baseten as inference sources — starting with Zen catalog/preset coverage, then Baseten as a second gateway route, then reasoning-model correctness in multi-tool agent loops.

**Architecture:** Artificer already routes all LLM traffic through a gateway (`LLM_BASE_URL`) + model id, using four AI SDK shapes in `packages/runtime/src/llm/provider.ts`. This plan extends the static catalog and presets for Zen-hosted open-weight models, documents Baseten as an alternate gateway via existing `quota.routes[]` failover, and adds model-specific `providerOptions` in `runToolLoop` so reasoning models preserve thinking across tool turns. No new AI SDK package is required for Phase 1–3; direct Cohere API support is explicitly out of scope.

**Tech Stack:** TypeScript, Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`), existing quota route system, node:test.

## Global Constraints

- **No new npm dependencies** unless a spike in Task 4 proves the AI SDK cannot pass reasoning options for a target model.
- **Zen remains the default gateway** — Baseten is opt-in via `quota.routes[]`, not a replacement for `go-economy` / `async-economy`.
- **Catalog pricing must match [OpenCode Zen docs](https://opencode.ai/docs/zen/)** for Zen model ids; Baseten slugs use [Baseten pricing](https://www.baseten.co/pricing) estimates rounded to 2 decimal places and marked with a code comment `// estimate — verify against Baseten /v1/models`.
- **Free-tier Zen models** (`*-free` suffix) use the existing `FREE` pricing constant in `catalog.ts`.
- **Do not change default `MODEL_PRESET`** (`go-economy` / `async-economy`) until Task 6 bench validation passes.
- **License awareness:** Kimi K3 uses the Kimi K3 License (commercial inference requires provider agreement). Document this in the guide; do not block catalog entries.

---

## File map

| File | Responsibility |
|---|---|
| `packages/runtime/src/llm/catalog.ts` | Model registry: ids, SDK package, pricing |
| `packages/runtime/src/llm/catalog.test.ts` | **Create** — `packageForModel` / `inferPackage` coverage |
| `packages/runtime/src/llm/reasoning-options.ts` | **Create** — model-specific `providerOptions` for reasoning |
| `packages/runtime/src/llm/reasoning-options.test.ts` | **Create** — unit tests for option builder |
| `packages/runtime/src/llm/loop.ts` | Accept `modelId`, merge reasoning `providerOptions` |
| `packages/runtime/src/llm/loop.test.ts` | Extend — assert reasoning options forwarded |
| `packages/runtime/src/engine/call.ts` | Pass `modelId` into `runToolLoop` |
| `packages/runtime/src/engine/presets.ts` | New `open-weights-economy` and `baseten-open-weights` presets |
| `packages/runtime/src/engine/presets.test.ts` | **Create** — preset shape smoke tests |
| `packages/runtime/artificer.config.schema.json` | Add new preset ids to `preset` enum |
| `packages/runtime/.env.example` | Document open-weights preset + Baseten env |
| `docs/reference/config.md` | Preset table entries |
| `docs/reference/env-vars.md` | `BASETEN_API_KEY` + gateway notes |
| `docs/guides/open-weights-inference.md` | **Create** — operator guide for all providers |
| `packages/runtime/bench/README.md` | Bench commands for new presets |

---

### Task 1: Zen open-weight catalog entries

**Files:**
- Modify: `packages/runtime/src/llm/catalog.ts`
- Create: `packages/runtime/src/llm/catalog.test.ts`

**Interfaces:**
- Consumes: existing `CatalogEntry`, `FREE`, `price()` helpers in `catalog.ts`.
- Produces: new catalog entries consumed by Task 2 (presets), Task 4 (reasoning patterns), `list-models` script, and `/api/config/models`.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/llm/catalog.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  catalogPricing,
  inferPackage,
  MODEL_CATALOG,
  packageForModel,
} from './catalog.js';

const ZEN_OPEN_WEIGHT_IDS = [
  'kimi-k3',
  'kimi-k2.7-code',
  'laguna-s-2.1-free',
  'north-mini-code-free',
] as const;

test('Zen open-weight models are in the catalog', () => {
  for (const id of ZEN_OPEN_WEIGHT_IDS) {
    assert.ok(MODEL_CATALOG[id], `missing catalog entry: ${id}`);
  }
});

test('Zen open-weight models use openai-compatible SDK package', () => {
  for (const id of ZEN_OPEN_WEIGHT_IDS) {
    assert.equal(packageForModel(id), '@ai-sdk/openai-compatible');
  }
});

test('free-tier models have zero pricing', () => {
  for (const id of ['laguna-s-2.1-free', 'north-mini-code-free'] as const) {
    const p = catalogPricing(id)!;
    assert.equal(p.inputPerMTok, 0);
    assert.equal(p.outputPerMTok, 0);
  }
});

test('kimi-k3 has published Zen pricing', () => {
  const p = catalogPricing('kimi-k3')!;
  assert.equal(p.inputPerMTok, 3);
  assert.equal(p.outputPerMTok, 15);
  assert.equal(p.cacheReadPerMTok, 0.3);
});

test('inferPackage handles baseten-style slugs', () => {
  assert.equal(
    inferPackage('moonshotai/Kimi-K3'),
    '@ai-sdk/openai-compatible',
  );
  assert.equal(
    inferPackage('thinkingmachines/inkling'),
    '@ai-sdk/openai-compatible',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @artificer-ai/runtime test src/llm/catalog.test.ts`
Expected: FAIL — `kimi-k3` / `laguna-s-2.1-free` missing from catalog; `inferPackage` may not match `moonshotai/` prefix.

- [ ] **Step 3: Add catalog entries and inferPackage prefix**

In `packages/runtime/src/llm/catalog.ts`, add to `ENTRIES` (OpenAI-compatible section, after `kimi-k2.6`):

```ts
  {
    id: 'kimi-k2.7-code',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.95, 4, 0.19),
  },
  {
    id: 'kimi-k3',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(3, 15, 0.3),
  },
  {
    id: 'laguna-s-2.1-free',
    npm: '@ai-sdk/openai-compatible',
    pricing: FREE,
  },
  {
    id: 'north-mini-code-free',
    npm: '@ai-sdk/openai-compatible',
    pricing: FREE,
  },
```

Extend `inferPackage()` before the final `return '@ai-sdk/openai-compatible'`:

```ts
  if (
    id.includes('/') ||
    id.startsWith('moonshotai/') ||
    id.startsWith('thinkingmachines/') ||
    id.startsWith('poolside/')
  ) {
    return '@ai-sdk/openai-compatible';
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @artificer-ai/runtime test src/llm/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Verify list-models output**

Run: `pnpm --filter @artificer-ai/runtime models`
Expected: `kimi-k3`, `laguna-s-2.1-free`, `north-mini-code-free` appear under OpenAI-compatible group.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/llm/catalog.ts packages/runtime/src/llm/catalog.test.ts
git commit -m "feat(runtime): add Zen open-weight models to LLM catalog"
```

---

### Task 2: Open-weights presets (Zen + Baseten)

**Files:**
- Modify: `packages/runtime/src/engine/presets.ts`
- Modify: `packages/runtime/artificer.config.schema.json`
- Create: `packages/runtime/src/engine/presets.test.ts`

**Interfaces:**
- Consumes: `getPreset`, `MODEL_PRESETS` from `presets.ts` (existing).
- Produces: `open-weights-economy` and `baseten-open-weights` preset ids for Task 3 docs, Task 6 bench, and `MODEL_PRESET` env.

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/src/engine/presets.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPreset, isPresetId } from './presets.js';

test('open-weights-economy preset exists with expected tiers', () => {
  assert.ok(isPresetId('open-weights-economy'));
  const preset = getPreset('open-weights-economy')!;
  assert.equal(preset.tiers.low, 'north-mini-code-free');
  assert.equal(preset.tiers.medium, 'laguna-s-2.1-free');
  assert.equal(preset.tiers.high, 'kimi-k3');
  assert.equal(preset.roleTiers.worker, 'medium');
});

test('baseten-open-weights preset uses Baseten slugs', () => {
  const preset = getPreset('baseten-open-weights')!;
  assert.equal(preset.tiers.low, 'thinkingmachines/inkling-small');
  assert.equal(preset.tiers.medium, 'thinkingmachines/inkling');
  assert.equal(preset.tiers.high, 'moonshotai/Kimi-K3');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @artificer-ai/runtime test src/engine/presets.test.ts`
Expected: FAIL — preset ids unknown.

- [ ] **Step 3: Add presets**

Append to `MODEL_PRESETS` in `packages/runtime/src/engine/presets.ts`:

```ts
  {
    id: 'open-weights-economy',
    name: 'Open weights economy',
    description:
      'Zen-hosted open-weight stack: North Mini Code and Laguna S free tiers for bulk work, Kimi K3 for escalation. Requires LLM_BASE_URL=https://opencode.ai/zen/v1.',
    tiers: {
      low: 'north-mini-code-free',
      medium: 'laguna-s-2.1-free',
      high: 'kimi-k3',
    },
    roleTiers: {
      ...ASYNC_ECONOMY_ROLES,
      reviewer: 'medium',
    },
  },
  {
    id: 'baseten-open-weights',
    name: 'Baseten open weights',
    description:
      'Baseten Model APIs: Inkling Small workers, Inkling coordination, Kimi K3 escalation. Requires LLM_BASE_URL=https://inference.baseten.co/v1 and BASETEN_API_KEY.',
    tiers: {
      low: 'thinkingmachines/inkling-small',
      medium: 'thinkingmachines/inkling',
      high: 'moonshotai/Kimi-K3',
    },
    roleTiers: {
      ...ASYNC_ECONOMY_ROLES,
      orchestrator: 'medium',
      reviewer: 'medium',
    },
  },
```

Add both ids to `preset.enum` in `packages/runtime/artificer.config.schema.json`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @artificer-ai/runtime test src/engine/presets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/presets.ts packages/runtime/src/engine/presets.test.ts packages/runtime/artificer.config.schema.json
git commit -m "feat(runtime): add open-weights and Baseten model presets"
```

---

### Task 3: Baseten gateway catalog slugs + operator docs

**Files:**
- Modify: `packages/runtime/src/llm/catalog.ts`
- Modify: `packages/runtime/.env.example`
- Create: `docs/guides/open-weights-inference.md`
- Modify: `docs/reference/env-vars.md`
- Modify: `docs/reference/config.md`

**Interfaces:**
- Consumes: `open-weights-economy` / `baseten-open-weights` presets from Task 2.
- Produces: Baseten slug catalog entries; operator documentation for gateway setup.

- [ ] **Step 1: Add Baseten catalog entries**

In `packages/runtime/src/llm/catalog.ts`, add Baseten Model API slugs (pricing estimates — verify against `GET https://inference.baseten.co/v1/models`):

```ts
  {
    id: 'thinkingmachines/inkling',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(1, 4.05, 0.17), // estimate — verify against Baseten /v1/models
  },
  {
    id: 'thinkingmachines/inkling-small',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(0.3, 1.2, 0.06), // estimate — verify against Baseten /v1/models
  },
  {
    id: 'moonshotai/Kimi-K3',
    npm: '@ai-sdk/openai-compatible',
    pricing: price(3, 15, 0.3), // estimate — verify against Baseten /v1/models
  },
```

Extend `catalog.test.ts` with assertions that these three ids exist.

- [ ] **Step 2: Write operator guide**

Create `docs/guides/open-weights-inference.md` covering:

1. **Quick start (Zen, zero config beyond preset):**
   ```bash
   LLM_BASE_URL=https://opencode.ai/zen/v1
   MODEL_PRESET=open-weights-economy
   ```

2. **Model reference table:**

   | Artificer id | Provider | Context | Notes |
   |---|---|---|---|
   | `north-mini-code-free` | Cohere via Zen | 256K | Apache 2.0, agentic coding |
   | `laguna-s-2.1-free` | Poolside via Zen | 1M | OpenMDW-1.1, text-only |
   | `kimi-k3` | Moonshot via Zen | 1M | Kimi K3 License, multimodal |
   | `thinkingmachines/inkling` | Baseten | 1M | Apache 2.0, multimodal |
   | `moonshotai/Kimi-K3` | Baseten | 1M | Same model, Baseten slug |

3. **Baseten failover route example** (append to `artificer.config.json`):
   ```json
   {
     "quota": {
       "routes": [
         {
           "id": "go-primary",
           "presetId": "go-economy",
           "llm": {
             "baseURL": "https://opencode.ai/zen/go/v1",
             "apiKeyEnv": "LLM_API_KEY"
           }
         },
         {
           "id": "baseten-open",
           "presetId": "baseten-open-weights",
           "llm": {
             "baseURL": "https://inference.baseten.co/v1",
             "apiKeyEnv": "BASETEN_API_KEY"
           }
         }
       ]
     }
   }
   ```

4. **External links:** [Poolside](https://poolside.ai/), [Cohere North Mini Code](https://cohere.com/blog/north-mini-code), [Kimi K3](https://huggingface.co/moonshotai/Kimi-K3), [Inkling](https://thinkingmachines.ai/news/introducing-inkling/), [Baseten Model APIs](https://docs.baseten.co/inference/model-apis/overview).

5. **License caveats** for Kimi K3 and Poolside OpenMDW.

- [ ] **Step 3: Update env-vars and config reference**

In `docs/reference/env-vars.md`, add:

| Variable | Required | Default | Description |
|---|---|---|---|
| `BASETEN_API_KEY` | For Baseten routes | — | API key for `https://inference.baseten.co/v1`; referenced by `quota.routes[].llm.apiKeyEnv` |

In `docs/reference/config.md` presets table, add rows for `open-weights-economy` and `baseten-open-weights` with one-line descriptions matching `presets.ts`.

In `packages/runtime/.env.example`, add commented block:

```bash
# Open-weights preset (Zen):
# MODEL_PRESET=open-weights-economy
# LLM_BASE_URL=https://opencode.ai/zen/v1
#
# Baseten gateway (use baseten-open-weights preset + quota route):
# BASETEN_API_KEY=
# LLM_BASE_URL=https://inference.baseten.co/v1
```

- [ ] **Step 4: Run catalog tests**

Run: `pnpm --filter @artificer-ai/runtime test src/llm/catalog.test.ts`
Expected: PASS (includes Baseten slug assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/llm/catalog.ts packages/runtime/src/llm/catalog.test.ts packages/runtime/.env.example docs/guides/open-weights-inference.md docs/reference/env-vars.md docs/reference/config.md
git commit -m "docs: add open-weights inference guide and Baseten catalog slugs"
```

---

### Task 4: Reasoning model providerOptions

**Files:**
- Create: `packages/runtime/src/llm/reasoning-options.ts`
- Create: `packages/runtime/src/llm/reasoning-options.test.ts`
- Modify: `packages/runtime/src/llm/loop.ts`
- Modify: `packages/runtime/src/llm/loop.test.ts`

**Interfaces:**
- Consumes: model id string from `call.ts` (Task 5).
- Produces: `reasoningProviderOptions(modelId: string): Record<string, unknown> | undefined` — merged into `generateText({ providerOptions })` in `runToolLoop`.

**Background:** Kimi K3, North Mini Code, Laguna S, and Inkling all use native reasoning. Multi-tool agent loops degrade when thinking content is not preserved or when reasoning is not enabled. The AI SDK's `generateText` with `stopWhen: stepCountIs(n)` manages multi-step history internally; this task ensures each step sends the correct reasoning configuration for known models.

- [ ] **Step 1: Spike — verify Zen accepts reasoning options**

Run a live curl against Zen (requires `LLM_API_KEY` in env):

```bash
curl -s https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "north-mini-code-free",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "reasoning_effort": "medium"
  }' | head -c 500
```

If `reasoning_effort` is rejected, retry with OpenRouter-style body:

```bash
curl -s https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer $LLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "laguna-s-2.1-free",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "reasoning": {"effort": "high"}
  }' | head -c 500
```

Record which field name Zen accepts. If neither works, document in `reasoning-options.ts` comment and skip request-level options for Zen free models (rely on provider defaults).

- [ ] **Step 2: Write the failing unit test**

Create `packages/runtime/src/llm/reasoning-options.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reasoningProviderOptions } from './reasoning-options.js';

test('kimi-k3 gets reasoning options', () => {
  const opts = reasoningProviderOptions('kimi-k3');
  assert.ok(opts);
  assert.ok(JSON.stringify(opts).includes('reasoning'));
});

test('north-mini-code-free gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('north-mini-code-free'));
});

test('laguna-s-2.1-free gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('laguna-s-2.1-free'));
});

test('thinkingmachines/inkling gets reasoning options', () => {
  assert.ok(reasoningProviderOptions('thinkingmachines/inkling'));
});

test('gpt-5.4-mini returns undefined', () => {
  assert.equal(reasoningProviderOptions('gpt-5.4-mini'), undefined);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @artificer-ai/runtime test src/llm/reasoning-options.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement reasoning-options.ts**

Create `packages/runtime/src/llm/reasoning-options.ts`:

```ts
/**
 * Model-specific providerOptions for reasoning-enabled models.
 * Shapes follow the AI SDK openai-compatible provider namespace.
 * Update after Task 4 Step 1 spike confirms Zen field names.
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
```

Adjust `openai.reasoningEffort` field names if Step 1 spike shows a different shape.

- [ ] **Step 5: Wire into runToolLoop**

In `packages/runtime/src/llm/loop.ts`:

1. Add `modelId?: string` to `RunToolLoopOptions`.
2. Import `mergeProviderOptions` from `./reasoning-options.js`.
3. Replace the hardcoded `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on the system message with:

```ts
...(modelId ? { providerOptions: mergeProviderOptions(modelId) } : {
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
}),
```

4. Also pass top-level `providerOptions` to `generateText` when `modelId` is set (AI SDK supports both call-level and message-level options — use call-level for reasoning):

```ts
result = await generateText({
  model,
  ...(modelId ? { providerOptions: mergeProviderOptions(modelId) } : {}),
  system: { ... },
  // ...
});
```

- [ ] **Step 6: Extend loop.test.ts**

Add test in `packages/runtime/src/llm/loop.test.ts`:

```ts
test('runToolLoop forwards reasoning providerOptions for kimi-k3', async () => {
  const model = new MockLanguageModelV3({ doGenerate: textResult('done') });

  await runToolLoop({
    model,
    modelId: 'kimi-k3',
    system: 'You are helpful.',
    userMessage: 'hello',
    tools: [],
    maxIterations: 1,
  });

  const [call] = model.doGenerateCalls;
  const opts = (call as { providerOptions?: Record<string, unknown> })
    .providerOptions;
  assert.ok(opts);
  assert.ok(JSON.stringify(opts).includes('reasoning'));
});
```

Update the existing cache-breakpoint test to pass no `modelId` so behavior is unchanged for non-reasoning models.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @artificer-ai/runtime test src/llm/reasoning-options.test.ts src/llm/loop.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/llm/reasoning-options.ts packages/runtime/src/llm/reasoning-options.test.ts packages/runtime/src/llm/loop.ts packages/runtime/src/llm/loop.test.ts
git commit -m "feat(runtime): forward reasoning providerOptions for open-weight models"
```

---

### Task 5: Thread modelId through call path

**Files:**
- Modify: `packages/runtime/src/engine/call.ts`

**Interfaces:**
- Consumes: `reasoningProviderOptions` / `mergeProviderOptions` via `runToolLoop({ modelId })` from Task 4.
- Produces: live agent calls pass the resolved model id into the tool loop.

- [ ] **Step 1: Locate runToolLoop invocation**

In `packages/runtime/src/engine/call.ts`, find the `runToolLoop({` call (inside the role execution function). The resolved model id is available from the `modelId` variable passed to `resolveLanguageModel` / `resolveModel` earlier in the same function.

- [ ] **Step 2: Pass modelId**

Add `modelId` to the `runToolLoop` options:

```ts
const result = await runToolLoop({
  model,
  modelId,
  system,
  userMessage: task,
  tools: roleTools,
  maxIterations,
  // ...existing options
});
```

- [ ] **Step 3: Run full runtime test suite**

Run: `pnpm --filter @artificer-ai/runtime test`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/engine/call.ts
git commit -m "feat(runtime): pass model id into tool loop for reasoning options"
```

---

### Task 6: Bench validation + smoke test checklist

**Files:**
- Modify: `packages/runtime/bench/README.md`
- Modify: `docs/guides/open-weights-inference.md` (append validation section)

**Interfaces:**
- Consumes: `open-weights-economy` preset, reasoning options from Tasks 4–5.
- Produces: documented validation procedure; go/no-go for promoting preset to default.

- [ ] **Step 1: Add bench commands to README**

In `packages/runtime/bench/README.md`, add section:

```markdown
## Open-weights presets

```bash
# Zen open-weights (requires LLM_BASE_URL=https://opencode.ai/zen/v1)
MODEL_PRESET=open-weights-economy pnpm bench:deepswe

# Baseten (requires BASETEN_API_KEY + LLM_BASE_URL=https://inference.baseten.co/v1)
MODEL_PRESET=baseten-open-weights LLM_BASE_URL=https://inference.baseten.co/v1 \
  LLM_API_KEY=$BASETEN_API_KEY pnpm bench:deepswe
```
```

- [ ] **Step 2: Manual multi-tool smoke test**

Start runtime with open-weights preset:

```bash
cd packages/runtime
MODEL_PRESET=open-weights-economy LLM_BASE_URL=https://opencode.ai/zen/v1 pnpm dev
```

POST a workstream task that requires **3+ tool calls** (e.g. "read package.json, read src/llm/catalog.ts, and list which models are missing from the catalog"). Inspect run logs for:

- [ ] No 400 errors mentioning `reasoning` or `reasoning_effort`
- [ ] Tool loop completes without `truncated: true` on first iteration
- [ ] Quality does not visibly degrade between tool call 1 and tool call 3

Repeat with `north-mini-code-free` as explicit `LLM_MODEL` override.

- [ ] **Step 3: Record results in guide**

Append to `docs/guides/open-weights-inference.md`:

```markdown
## Validation checklist

- [ ] `pnpm --filter @artificer-ai/runtime test` passes
- [ ] `pnpm --filter @artificer-ai/runtime models` lists new Zen entries
- [ ] Multi-tool smoke test passes for `north-mini-code-free`
- [ ] Multi-tool smoke test passes for `laguna-s-2.1-free`
- [ ] (Optional) DeepSWE mini bench run recorded under `bench/results/open-weights-economy/`
```

Fill in checkboxes with actual results before marking this task done.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/bench/README.md docs/guides/open-weights-inference.md
git commit -m "docs: add open-weights bench and validation checklist"
```

---

## Out of scope (future plans)

| Item | Why deferred |
|---|---|
| Direct Cohere API (`@ai-sdk/cohere`) | Zen + vLLM cover North Mini Code; new SDK shape is disproportionate |
| Direct Poolside Platform API | OpenRouter/Vercel/Zen already expose Laguna |
| Tinker fine-tuning integration | Training platform, not production inference |
| UI gateway labels for Baseten | Routes already editable in Providers page; no new UI needed for v1 |
| Multimodal inputs (Kimi K3 vision, Inkling audio) | Artificer agent loop is text-only today |
| Self-hosted vLLM preset | Operator-specific; document in guide, don't codify hardware assumptions |

---

## Self-review (spec coverage)

| Research recommendation | Task |
|---|---|
| Catalog: kimi-k3, laguna-s-2.1-free, north-mini-code-free | Task 1 |
| Preset: open-weights-economy | Task 2 |
| Baseten as second gateway | Task 3 |
| Baseten slugs in catalog | Task 3 |
| Reasoning preservation in tool loops | Task 4, 5 |
| Bench validation before default preset change | Task 6 (explicitly does NOT change default) |
| Operator documentation | Task 3, 6 |
| License caveats | Task 3 guide |
