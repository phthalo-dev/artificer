const NOISE_PREFIXES = [
  '<local-command-caveat>',
  '<command-name>',
  '<command-message>',
  '<local-command-stdout>',
  '<local-command-stderr>',
  '<task-notification',
  '<environment_context>',
  '<user_instructions>',
  '<permissions instructions>',
  '<turn_context>',
];

const INSTRUCTION_RE = new RegExp(
  [
    String.raw`^(?:always|never|don't|do not|prefer)\b`,
    String.raw`\balways (?:use|run|write|prefer|add|include|check|keep|put|start|ask|test)\b`,
    String.raw`\bnever (?:use|commit|push|run|add|leave|skip|edit|delete|force|merge)\b`,
    String.raw`\bi prefer\b`,
    String.raw`\bi always (?:use|run|prefer|want|write)\b`,
    String.raw`\bi want you to\b`,
    String.raw`\bmake sure (?:to|you)\b`,
    String.raw`\bplease (?:always|never|don't|do not)\b`,
    String.raw`\byou should(?: not)?(?: always| never)?\b`,
    String.raw`\bdo not\b`,
  ].join('|'),
  'i',
);

export function extractPreferences(userTexts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of userTexts) {
    for (const sentence of splitSentences(unwrapUserText(raw))) {
      if (!isPreference(sentence)) continue;
      const key = normalizeKey(sentence);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(sentence);
    }
  }
  return out;
}

export function unwrapUserText(text: string): string {
  const query = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  if (query?.[1]) return query[1].trim();
  return text
    .replace(/<timestamp>[\s\S]*?<\/timestamp>\s*/gi, '')
    .replace(/<attached_files>[\s\S]*?<\/attached_files>\s*/gi, '')
    .trim();
}

export function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPreference(sentence: string): boolean {
  if (sentence.length < 12 || sentence.length > 500) return false;
  if (sentence.endsWith('?')) return false;
  if (sentence.includes('```')) return false;
  if (/^diff --git\b/.test(sentence) || /^[+-]{3}\s/.test(sentence)) {
    return false;
  }
  const head = sentence.trimStart();
  if (NOISE_PREFIXES.some((prefix) => head.startsWith(prefix))) return false;
  return INSTRUCTION_RE.test(sentence);
}

function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
