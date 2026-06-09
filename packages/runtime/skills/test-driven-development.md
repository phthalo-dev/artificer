# Test-Driven Development

Adapted from superpowers:test-driven-development. Use when implementing features or bug fixes.

## Iron law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

If you wrote code before the test, delete it and start over from the test.

## Red-green-refactor

1. **RED** — Write one minimal test for one behaviour. Clear name, real code (avoid mocks unless unavoidable).
2. **Verify RED** — Run the test. It must fail for the expected reason (feature missing, not a typo). If it passes, the test is wrong.
3. **GREEN** — Write the minimal code to pass. No extra features, no opportunistic refactors.
4. **Verify GREEN** — Re-run; confirm pass and no regressions.
5. **REFACTOR** — Clean up only while staying green.

## Discover the repo first

Before assuming a test command, read package.json scripts, Makefile, CI config, and existing test layout.

## When tests are out of scope

If the workstream forbids test changes (bench/SWE eval) or the repo has no harness and adding one is out of scope, say so and use the most rigorous verification available.

## Red flags — stop and restart with TDD

- Code before test
- Test passes immediately on first run
- "I'll add tests after"
- Rationalizing "just this once"
