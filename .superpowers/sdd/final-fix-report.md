# Recurring schedules final-fix report

## Fixes

- `createRuntime` now resolves an SDK-supplied `identity.pullInterval` into
  `identity.pullIntervalMs`, matching file-definition behavior.
- Invalid `identity.pullInterval` values now emit a clear `console.warn` that
  periodic pulling is disabled.
- The GitHub watch-interval schema accepts day (`d`) units.
- Terminal helper coverage now includes failed runs and no matching runs.

## Verification

```text
$ node --import tsx --test src/config.test.ts src/api/create-runtime.test.ts src/engine/schedule-runner-host.test.ts
ℹ tests 14
ℹ suites 2
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

```text
$ pnpm type-check
> @artificer-ai/runtime@0.9.4 type-check
> tsc --noEmit
```
