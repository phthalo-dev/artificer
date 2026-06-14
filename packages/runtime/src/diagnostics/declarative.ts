import path from 'node:path';
import { parserFor } from './parsers.js';
import type {
  DeclarativeProvider,
  DiagnoseContext,
  LanguageProvider,
} from './types.js';

/** Quote a path for safe interpolation into a shell command. */
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * Turn a declarative config entry into a LanguageProvider. This is the path
 * consumers use to add languages/frameworks without writing code.
 */
export function makeCommandProvider(
  spec: DeclarativeProvider,
): LanguageProvider {
  const extensions = new Set(spec.extensions.map((e) => e.toLowerCase()));
  const filenames = new Set(spec.filenames ?? []);

  return {
    id: spec.id,
    matches(file) {
      if (filenames.has(path.basename(file))) return true;
      return extensions.has(path.extname(file).toLowerCase());
    },
    async isAvailable(ctx) {
      if (!spec.availableWhen) return true;
      return ctx.which(spec.availableWhen);
    },
    async diagnose(ctx) {
      const fileArgs = ctx.files.map(shellQuote).join(' ');
      const command = spec.command.includes('{files}')
        ? spec.command.replaceAll('{files}', fileArgs)
        : spec.command;
      const result = await ctx.exec(command);
      return parserFor(result, spec.parser, {
        pattern: spec.pattern,
        source: spec.id,
      });
    },
  };
}
