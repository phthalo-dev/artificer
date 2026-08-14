export type LlmJudgeComplete = (prompt: string) => Promise<string>;

export function buildLlmJudgePrompt(rubric: string, material: string): string {
  return [
    'You are grading an AI coding agent. Reply with a single last line that is exactly PASS or FAIL.',
    '',
    'Rubric:',
    rubric.trim(),
    '',
    'Material to grade:',
    material.trim() || '(empty)',
    '',
    'Last line must be PASS or FAIL.',
  ].join('\n');
}

/** True when the judge response's last non-empty line is PASS. */
export function parseLlmJudgeVerdict(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines[lines.length - 1] ?? '';
  if (/^PASS\b/i.test(last)) return true;
  if (/^FAIL\b/i.test(last)) return false;
  return /\bPASS\b/i.test(last) && !/\bFAIL\b/i.test(last);
}

export async function gradeLlmJudge(options: {
  rubric: string;
  material: string;
  complete: LlmJudgeComplete;
}): Promise<boolean> {
  const response = await options.complete(
    buildLlmJudgePrompt(options.rubric, options.material),
  );
  return parseLlmJudgeVerdict(response);
}

/**
 * Default judge: OpenAI-compatible chat completions using the same env the
 * runtime already documents (LLM_API_KEY / LLM_BASE_URL / LLM_MODEL).
 */
export async function defaultLlmJudgeComplete(
  prompt: string,
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'llm-judge requires LLM_API_KEY (or pass a custom complete function)',
    );
  }
  const baseUrl = (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  const model =
    process.env.LLM_MODEL_HIGH ??
    process.env.LLM_MODEL ??
    process.env.LLM_MODEL_MEDIUM ??
    'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(
      `llm-judge request failed: ${response.status} ${response.statusText}`,
    );
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return body.choices?.[0]?.message?.content ?? '';
}
