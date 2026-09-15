---
title: Open-Weights Inference
description: Artificer can route LLM traffic through OpenCode Zen for hosted open-weight models (Poolside Laguna S, Cohere North Mini Code, Kimi K3) or through Baseten Model APIs for Inkling and Kimi K3 under provider-native slugs.
---

# Open-Weights Inference

Artificer can route LLM traffic through OpenCode Zen for hosted open-weight models (Poolside Laguna S, Cohere North Mini Code, Kimi K3) or through Baseten Model APIs for Inkling and Kimi K3 under provider-native slugs. Zen remains the default gateway; Baseten is opt-in via quota failover routes.

## Quick start (Zen)

Set the open-weights preset and point at Zen — no other gateway config required beyond your existing `LLM_API_KEY`:

```bash
LLM_BASE_URL=https://opencode.ai/zen/v1
MODEL_PRESET=open-weights-economy
```

The preset maps low-tier roles to Cohere North Mini Code (`north-mini-code-free`), medium-tier roles to Poolside Laguna S (`laguna-s-2.1-free`), and high-tier escalation to Kimi K3 (`kimi-k3`).

## Model reference

| Artificer id | Provider | Context | Notes |
|---|---|---|---|
| `north-mini-code-free` | Cohere via Zen | 256K | Apache 2.0, agentic coding |
| `laguna-s-2.1-free` | Poolside via Zen | 1M | OpenMDW-1.1, text-only |
| `kimi-k3` | Moonshot via Zen | 1M | Kimi K3 License, multimodal |
| `thinkingmachines/inkling` | Baseten | 1M | Apache 2.0, multimodal |
| `moonshotai/Kimi-K3` | Baseten | 1M | Same model, Baseten slug |

## Baseten failover route

To use Baseten as a secondary gateway (for example when the primary Go route is exhausted), append routes to `artificer.config.json`:

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

Set `BASETEN_API_KEY` in your environment (or platform secrets). The `baseten-open-weights` preset uses Inkling Small for workers, Inkling for coordination, and Kimi K3 for escalation.

## License caveats

**Kimi K3** is distributed under the [Kimi K3 License](https://huggingface.co/moonshotai/Kimi-K3), not a permissive open-source license. Review the license terms before deploying in production or redistributing outputs in regulated contexts.

**Poolside Laguna S** weights are released under [OpenMDW-1.1](https://poolside.ai/). OpenMDW restricts certain use cases (including training competing models on outputs). Confirm your workload complies before relying on `laguna-s-2.1-free` at scale.

## Validation checklist

- [x] `pnpm --filter @artificer-ai/runtime test` passes (450/450, 2026-08-09)
- [x] `pnpm --filter @artificer-ai/runtime models` lists new Zen entries (`north-mini-code-free`, `laguna-s-2.1-free`, `kimi-k3`) and Baseten slugs (`thinkingmachines/inkling`, `moonshotai/Kimi-K3`)
- [ ] Multi-tool smoke test passes for `north-mini-code-free` — see [Manual smoke test](#manual-smoke-test) below
- [ ] Multi-tool smoke test passes for `laguna-s-2.1-free` — see [Manual smoke test](#manual-smoke-test) below
- [ ] (Optional) DeepSWE mini bench run recorded under `bench/results/open-weights-economy/`

### Manual smoke test

Start the runtime with the open-weights preset:

```bash
cd packages/runtime
MODEL_PRESET=open-weights-economy LLM_BASE_URL=https://opencode.ai/zen/v1 pnpm dev
```

POST a workstream task that requires **3+ tool calls** (for example: "read package.json, read src/llm/catalog.ts, and list which models are missing from the catalog"). Inspect run logs for:

- [ ] No 400 errors mentioning `reasoning` or `reasoning_effort`
- [ ] Tool loop completes without `truncated: true` on first iteration
- [ ] Quality does not visibly degrade between tool call 1 and tool call 3

Repeat with `north-mini-code-free` as an explicit `LLM_MODEL` override, then again with `laguna-s-2.1-free`.

**Minimal API probe (2026-08-09):** `laguna-s-2.1-free` via Zen returned HTTP 200 with `reasoning_effort: high` (no 400). `north-mini-code-free` returned upstream 401 from the Cohere provider on Zen — reasoning field validation was inconclusive; retry when Zen/Cohere auth is resolved.

## Further reading

- [Poolside](https://poolside.ai/)
- [Cohere North Mini Code](https://cohere.com/blog/north-mini-code)
- [Kimi K3 on Hugging Face](https://huggingface.co/moonshotai/Kimi-K3)
- [Inkling announcement](https://thinkingmachines.ai/news/introducing-inkling/)
- [Baseten Model APIs](https://docs.baseten.co/inference/model-apis/overview)
