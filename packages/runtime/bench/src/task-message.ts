import type { BenchInstance } from './types.js';

/** Harbor / mini-swe-agent style workflow and patch discipline for DeepSWE. */
export function buildDeepSweWorkflowSection(repoDir: string): string {
  return [
    '## Recommended workflow',
    '',
    '1. Analyze the codebase — list and read relevant files under the repo.',
    '2. Reproduce or understand the requirement (run existing tests or a small script).',
    '3. Edit source files to implement the requested behavior.',
    '4. Verify with the project test/build command and read the actual output.',
    '5. Check edge cases before finishing.',
    '',
    '## Boundaries',
    '',
    `- MODIFY: production source under \`${repoDir}/\` only.`,
    '- DO NOT MODIFY: test files, config-only churn, or helper scripts you create for debugging.',
    '- The external verifier supplies tests; leave test files unchanged.',
    '',
    '## Patch discipline (before you finish)',
    '',
    '1. Run `git diff` (or `git diff --cached`) and confirm only intended source files changed.',
    '2. Ensure diff headers show `--- a/` and `+++ b/` paths.',
    '3. Do not include scratch files, reproduction scripts, or ad-hoc test runners in the change.',
    '4. End with status DONE only after you have verified the change.',
  ].join('\n');
}

/** Shell execution hints aligned with mini-swe-agent (stateless subshells). */
export function buildShellExecutionHints(): string {
  return [
    '## Command execution',
    '',
    'Each run_shell invocation uses a fresh subshell — directory and env changes do not persist.',
    'Prefix commands with `cd path &&` or `VAR=val cd path &&` when needed.',
    'Use non-interactive flags (-y, -f). Avoid vi, nano, and other interactive tools.',
  ].join('\n');
}

export function buildDeepSweTaskBody(
  instance: BenchInstance,
  options: { preflight?: boolean; docker?: boolean },
): string {
  const repoDir = options.docker ? 'repo' : options.preflight ? 'repo' : 'your workspace clone';
  const workflow = buildDeepSweWorkflowSection(repoDir);
  const shellHints = buildShellExecutionHints();

  if (options.preflight || options.docker) {
    const envNote = options.docker
      ? 'The repository is bootstrapped from the task Docker image at `repo/` (dependencies installed). Use run_shell for builds and tests — commands execute inside the evaluator image.'
      : 'The repository is already cloned at `repo/` and checked out at the base commit.';

    return [
      `Complete the software engineering task below in ${instance.repo}.`,
      '',
      envNote,
      'Investigate with read_file, grep, and run_shell on the local tree.',
      'Implement the requested behavior by editing the repository source.',
      'The verifier tests observable behavior, not a specific implementation shape.',
      'Do not modify or add test files. Do not open a pull request; leave the',
      'change applied in the working tree.',
      '',
      workflow,
      '',
      shellHints,
      '',
      instance.problem_statement,
    ].join('\n');
  }

  const repoUrl =
    instance.repository_url ?? `https://github.com/${instance.repo}.git`;

  return [
    `Complete the software engineering task below in ${instance.repo}.`,
    '',
    'Setup (do this first, exactly):',
    `1. Clone ${repoUrl} into your workspace as \`repo/\`.`,
    `2. Check out the exact base commit ${instance.base_commit}.`,
    '',
    'Implement the requested behavior by editing the repository source.',
    'The verifier tests observable behavior, not a specific implementation shape.',
    'Do not modify or add test files. Do not open a pull request; leave the',
    'change applied in the working tree.',
    '',
    workflow,
    '',
    shellHints,
    '',
    instance.problem_statement,
  ].join('\n');
}
