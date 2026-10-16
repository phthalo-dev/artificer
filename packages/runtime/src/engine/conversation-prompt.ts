export const TRANSCRIPT_MAX_MESSAGES = 30;
export const TRANSCRIPT_MAX_CHARS = 40_000;

export function conversationPreamble(input: {
  workstreamId: string;
  goal: string;
  repoPath: string;
}): string {
  return [
    `Workstream goal: ${input.goal}`,
    `Branch: artificer/${input.workstreamId}`,
    `Repository path: ${input.repoPath}`,
    'Work in this repository. To keep a markdown note or other document on the workstream, call publish_workstream_artifact (or the publish_artifact MCP tool) with a key, a name, and the content.',
  ].join('\n');
}

export function conversationPrompt(input: {
  preamble: string;
  prior: Array<{ direction: 'inbound' | 'outbound'; content: string }>;
  content: string;
  resume: boolean;
}): string {
  if (input.resume) return input.content;

  const accepted: string[] = [];
  let remaining = TRANSCRIPT_MAX_CHARS;

  for (
    let index = input.prior.length - 1;
    index >= 0 && accepted.length < TRANSCRIPT_MAX_MESSAGES && remaining > 0;
    index -= 1
  ) {
    const message = input.prior[index];
    const content =
      message.content.length <= remaining
        ? message.content
        : message.content.slice(-remaining);
    const speaker = message.direction === 'inbound' ? 'User' : 'Agent';

    accepted.unshift(`[${speaker}]: ${content}`);
    remaining -= content.length;
  }

  return [input.preamble, ...accepted, `[User]: ${input.content}`].join('\n\n');
}
