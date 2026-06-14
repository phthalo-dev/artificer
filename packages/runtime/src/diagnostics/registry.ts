import { makeCommandProvider } from './declarative.js';
import { pythonProvider } from './providers/python.js';
import { typescriptProvider } from './providers/typescript.js';
import type { DiagnosticsConfig, LanguageProvider } from './types.js';

/**
 * Build the ordered provider list for a config. Consumer-supplied declarative
 * providers come first so they can override a built-in for the same extension.
 */
export function buildProviders(config: DiagnosticsConfig): LanguageProvider[] {
  const providers: LanguageProvider[] = [];

  for (const spec of config.providers ?? []) {
    providers.push(makeCommandProvider(spec));
  }

  providers.push(pythonProvider);
  if (config.typescript) providers.push(typescriptProvider);

  return providers;
}

/** First provider whose `matches` accepts the file, or undefined. */
export function providerFor(
  providers: LanguageProvider[],
  file: string,
): LanguageProvider | undefined {
  return providers.find((p) => p.matches(file));
}
