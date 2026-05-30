import {
  type LlmSdkPackage,
  MODEL_CATALOG,
  type ModelPricing,
} from '../llm/catalog.js';

/** Human-readable grouping for each AI SDK package / Zen API shape. */
const GROUPS: Array<{ npm: LlmSdkPackage; title: string }> = [
  { npm: '@ai-sdk/anthropic', title: 'Anthropic Messages (Claude, Qwen)' },
  { npm: '@ai-sdk/openai', title: 'OpenAI Responses (GPT)' },
  { npm: '@ai-sdk/google', title: 'Google (Gemini)' },
  { npm: '@ai-sdk/openai-compatible', title: 'OpenAI-compatible (GLM, MiniMax, Kimi, ...)' },
];

function fmtPrice(p: ModelPricing): string {
  if (p.inputPerMTok === 0 && p.outputPerMTok === 0) return 'free';
  return `in $${p.inputPerMTok}/Mtok  out $${p.outputPerMTok}/Mtok`;
}

const all = Object.values(MODEL_CATALOG);
const idWidth = Math.max(...all.map((e) => e.id.length)) + 2;

console.log('\nOpenCode Zen models (set via LLM_MODEL / LLM_MODEL_LOW / LLM_MODEL_HIGH)\n');

for (const group of GROUPS) {
  const entries = all.filter((e) => e.npm === group.npm);
  if (entries.length === 0) continue;
  console.log(`${group.title}`);
  for (const entry of entries) {
    console.log(`  ${entry.id.padEnd(idWidth)}${fmtPrice(entry.pricing)}`);
  }
  console.log('');
}
