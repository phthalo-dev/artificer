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

## Further reading

- [Poolside](https://poolside.ai/)
- [Cohere North Mini Code](https://cohere.com/blog/north-mini-code)
- [Kimi K3 on Hugging Face](https://huggingface.co/moonshotai/Kimi-K3)
- [Inkling announcement](https://thinkingmachines.ai/news/introducing-inkling/)
- [Baseten Model APIs](https://docs.baseten.co/inference/model-apis/overview)
