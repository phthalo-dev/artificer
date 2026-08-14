`getState()` in `src/state.js` should expose a `paused` boolean on the
status payload (stand-in for `/api/state`). It must be `true` when any
workstream has `status: "paused"`, otherwise `false`. The field was dropped
in a recent regression — restore it.
