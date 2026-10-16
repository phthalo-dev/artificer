import type { Workstream } from '../storage/types.js';

export function shouldStepWorkstream(driver: Workstream['driver']): boolean {
  return driver !== 'conversation';
}
