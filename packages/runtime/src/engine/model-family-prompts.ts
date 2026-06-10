import { packageForModel } from '../llm/catalog.js';

export type ModelFamily = 'openai' | 'anthropic' | 'google' | 'other';

/** Map a resolved model id to a coarse family for prompt tailoring. */
export function modelFamilyFromId(modelId: string): ModelFamily {
  const pkg = packageForModel(modelId);
  switch (pkg) {
    case '@ai-sdk/openai':
    case '@ai-sdk/openai-compatible':
      return 'openai';
    case '@ai-sdk/anthropic':
      return 'anthropic';
    case '@ai-sdk/google':
      return 'google';
    default:
      return 'other';
  }
}

/**
 * Short execution guidance tuned to how each model family tends to behave in
 * long tool loops (borrowed from Cline/Hermes family-specific prompts).
 */
export function modelFamilyPromptExtension(family: ModelFamily): string {
  switch (family) {
    case 'openai':
      return (
        '\n\n## Execution guidance (GPT)\n' +
        '- Keep calling tools until the task is fully verified; do not stop after planning.\n' +
        '- After edits, run the relevant test or build command before declare_done.\n' +
        '- If a tool fails, read the error, adjust, and retry with a different approach.\n' +
        '- Prefer small, focused edits over large rewrites.'
      );
    case 'google':
      return (
        '\n\n## Execution guidance (Gemini)\n' +
        '- Use absolute paths under the workspace for all file and shell operations.\n' +
        '- Batch independent read_file / grep calls in parallel when exploring.\n' +
        '- Re-read a file after editing it before assuming contents.\n' +
        '- Run tests locally and cite the exact command in declare_done.'
      );
    case 'anthropic':
      return (
        '\n\n## Execution guidance (Claude)\n' +
        '- Be concise in assistant text; spend tokens on tool calls and verification.\n' +
        '- Use read_file for source; never sed/cat/tail/grep via run_shell to read files.\n' +
        '- Call edit_file early — do not spend many turns browsing before implementing.\n' +
        '- declare_done only after you have run verification yourself this session.\n' +
        '- If stuck after several attempts, call declare_blocked with what you tried.'
      );
    default:
      return '';
  }
}

/** Convenience: extension text for a concrete model id. */
export function modelFamilyPromptForModel(modelId: string): string {
  return modelFamilyPromptExtension(modelFamilyFromId(modelId));
}
