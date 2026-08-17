---
'@artificer-ai/runtime': patch
---

Pick prior-run digest size from the active model family (GPT-5 compact earlier, Gemini keep more history) instead of a fixed 8-run window, with `RUNTIME_COMPACTION_PROFILE` for bench A/B.
