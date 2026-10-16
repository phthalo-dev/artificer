import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkstreamArtifactService } from './workstream-artifacts.js';

const execFileAsync = promisify(execFile);

export interface PullRequestMention {
  url: string;
  owner: string;
  repo: string;
  number: number;
  key: string;
}

interface PullRequestCaptureDeps {
  artifacts: WorkstreamArtifactService;
  gh?: (args: string[]) => Promise<{ title: string }>;
}

export function pullRequestMentions(text: string): PullRequestMention[] {
  const pattern =
    /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;
  return [...text.matchAll(pattern)].map((match) => {
    const [, owner, repo, rawNumber] = match;
    const number = Number.parseInt(rawNumber, 10);
    const key = `pr-${owner}-${repo}-${number}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-');
    return { url: match[0], owner, repo, number, key };
  });
}

async function viewPullRequest(args: string[]): Promise<{ title: string }> {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8' });
  return JSON.parse(stdout) as { title: string };
}

export async function capturePullRequests(
  deps: PullRequestCaptureDeps,
  workstreamId: string,
  text: string,
): Promise<void> {
  let existing;
  try {
    existing = await deps.artifacts.list(workstreamId);
  } catch {
    return;
  }
  const keys = new Set(existing.map((artifact) => artifact.key));
  const gh = deps.gh ?? viewPullRequest;

  for (const mention of pullRequestMentions(text)) {
    if (keys.has(mention.key)) continue;

    try {
      let name: string;
      try {
        ({ title: name } = await gh([
          'pr',
          'view',
          mention.url,
          '--json',
          'title',
        ]));
      } catch {
        name = `Pull request #${mention.number}`;
      }

      await deps.artifacts.publish(workstreamId, {
        key: mention.key,
        name,
        content: `# ${name}\n\n${mention.url}\n`,
        metadata: {
          url: mention.url,
          owner: mention.owner,
          repo: mention.repo,
          number: mention.number,
        },
      });
      keys.add(mention.key);
    } catch {
      // Pull request capture is best-effort and must not fail the run.
    }
  }
}
