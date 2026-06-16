import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGitEnv } from '../tools/git-env.js';
import type { Engine } from './engine.js';
import { runGithubWatchCycle, type GithubWatchState } from './github-watch.js';

const execAsync = promisify(exec);

/**
 * Runs one GitHub watch cycle for `engine`, using its configured `gh`
 * credentials, persisting the resulting state via the store.
 */
export async function runGithubWatchOnce(
  engine: Engine,
  log?: (message: string) => void,
): Promise<GithubWatchState> {
  const env = buildGitEnv(engine.config.github);
  const runGh = async (args: string): Promise<string> => {
    const { stdout } = await execAsync(`gh ${args}`, {
      env,
      timeout: 1000 * 60 * 5,
      maxBuffer: 1024 * 1024 * 20,
    });
    return stdout;
  };

  const state = await engine.store.readGithubWatchState();
  const updated = await runGithubWatchCycle({
    runGh,
    state,
    receiveMessage: (content) => engine.receiveMessage(content),
    log,
  });
  await engine.store.writeGithubWatchState(updated);
  return updated;
}
