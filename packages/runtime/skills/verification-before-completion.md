# Verification Before Completion

Adapted from superpowers:verification-before-completion. Use before claiming work is done, fixed, or passing.

## Iron law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

## Gate (every time)

1. **Identify** — what command proves this claim?
2. **Run** — execute the full command in this call (not a previous turn).
3. **Read** — full output, exit code, failure count.
4. **Verify** — does output support the claim?
5. **Only then** — state the claim with evidence (command + result).

## Not sufficient

| Claim | Requires | Not enough |
|-------|----------|------------|
| Tests pass | Test output: 0 failures | "Should pass", earlier run |
| Build succeeds | Build exit 0 | Linter clean, logs look fine |
| Bug fixed | Symptom test passes | Code changed, assumed fixed |

## Red flags

- "Should", "probably", "seems to"
- Satisfaction before verification ("Done!", "Perfect!")
- Partial checks
- Trusting another agent's success report without checking the diff yourself
