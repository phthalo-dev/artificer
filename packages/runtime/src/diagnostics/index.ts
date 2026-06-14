export { makeCommandProvider } from './declarative.js';
export { buildProviders, providerFor } from './registry.js';
export { makeExec, runDiagnostics } from './service.js';
export type {
  BuiltinParser,
  DeclarativeProvider,
  Diagnostic,
  DiagnoseContext,
  DiagnosticParser,
  DiagnosticsConfig,
  ExecResult,
  LanguageProvider,
} from './types.js';
