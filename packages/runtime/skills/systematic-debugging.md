# Systematic Debugging

Adapted from superpowers:systematic-debugging. Use when anything fails — tests, builds, or unexpected behaviour.

## Iron law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

## Four phases (complete each before the next)

### 1. Root cause investigation

- Read the full error — stack traces, line numbers, codes.
- Reproduce consistently; note exact steps.
- Check recent changes (git diff, new deps, config).
- In multi-component flows, gather evidence at each boundary before proposing fixes.

### 2. Pattern analysis

- Find similar working code in the repo.
- Compare working vs broken; list every difference.
- Read reference implementations completely — do not skim.

### 3. Hypothesis and testing

- State one hypothesis: "X is the cause because Y."
- Make the smallest change that tests it. One variable at a time.
- Failed? Form a new hypothesis — do not stack fixes.

### 4. Implementation

- Fix the root cause, not the symptom.
- Verify with the relevant command before claiming success.

## Stop thrashing

If three fix attempts have not worked, stop: report what you tried and the remaining failure as BLOCKED so the orchestrator can re-route. Three failures may indicate an architectural problem — do not attempt a fourth speculative fix.

## Red flags — return to phase 1

- "Quick fix for now, investigate later"
- "Just try changing X and see"
- Multiple changes before re-running tests
- Proposing solutions before reading the error
