export interface PullableIdentity {
  pullFromRemote(): Promise<'updated' | 'unchanged' | 'conflict' | 'error'>;
}

export async function runIdentityPullCycle({
  identity,
  reloadSchedules,
  log,
}: {
  identity: PullableIdentity;
  reloadSchedules: () => void | Promise<void>;
  log?: (message: string) => void;
}): Promise<void> {
  const result = await identity.pullFromRemote();
  if (result === 'updated') {
    await reloadSchedules();
    log?.('identity updated; schedules reloaded');
    return;
  }
  if (result !== 'unchanged') log?.(`pull ${result}`);
}
