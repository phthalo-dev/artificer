/**
 * Tiny stand-in for runtime /api/state — returns a status payload.
 */
export function getState(workstreams = []) {
  return {
    status: 'ok',
    workstreams,
    paused: workstreams.some((w) => w.status === 'paused'),
  };
}
