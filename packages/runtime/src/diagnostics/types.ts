/** A single problem reported by a language's checker, normalized. */
export interface Diagnostic {
  /** Path as reported by the tool (absolute or relative). */
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The checker that produced it, e.g. 'tsc' or 'ruff'. */
  source: string;
}

/** Result of running a checker command. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code; non-zero usually means problems were found. */
  code: number;
}

/** Everything a provider needs to inspect freshly-edited files. */
export interface DiagnoseContext {
  /** Absolute workspace root. */
  workspaceDir: string;
  /** Environment for spawned commands (GitHub auth, PATH, ...). */
  env: NodeJS.ProcessEnv;
  /** Workspace-relative paths that were just edited. */
  files: string[];
  /** Per-command timeout. */
  timeoutMs: number;
  /** Run a shell command from the workspace root (or `opts.cwd`). */
  exec(command: string, opts?: { cwd?: string }): Promise<ExecResult>;
  /** Whether a binary is resolvable on PATH. */
  which(binary: string): Promise<boolean>;
}

/** Turns raw command output into normalized diagnostics. */
export type DiagnosticParser = (result: ExecResult) => Diagnostic[];

/**
 * A language/framework checker. Built-ins implement this directly; consumers
 * typically use the declarative `makeCommandProvider` factory instead.
 */
export interface LanguageProvider {
  /** Stable id, e.g. 'python' | 'typescript'. */
  id: string;
  /** Does this provider handle the given workspace-relative file? */
  matches(file: string): boolean;
  /**
   * Cheap gate: is this toolchain usable here (binary installed, config
   * present)? Returning false makes the provider silently skip — we never nag
   * the model about a checker that is not set up.
   */
  isAvailable(ctx: DiagnoseContext): Promise<boolean>;
  /** Run the checker over `ctx.files` and return normalized diagnostics. */
  diagnose(ctx: DiagnoseContext): Promise<Diagnostic[]>;
}

/** Built-in parser names usable from declarative consumer config. */
export type BuiltinParser =
  | 'tsc'
  | 'ruff-json'
  | 'eslint-json'
  | 'regex'
  | 'exit-code';

/** A consumer-supplied checker expressed as data rather than code. */
export interface DeclarativeProvider {
  id: string;
  /** File extensions this handles, e.g. ['.go']. Include the leading dot. */
  extensions: string[];
  /** Optional exact filenames this handles, e.g. ['Dockerfile']. */
  filenames?: string[];
  /** Binary that must be on PATH for the provider to run. */
  availableWhen?: string;
  /**
   * Command to run. `{files}` expands to the space-separated edited files;
   * omit it to run a project-wide command.
   */
  command: string;
  /** How to interpret the command output. */
  parser: BuiltinParser;
  /** Required when parser is 'regex': named groups file/line/col/message. */
  pattern?: string;
}

/** Diagnostics behavior, resolved from env and/or consumer config. */
export interface DiagnosticsConfig {
  enabled: boolean;
  timeoutMs: number;
  maxPerFile: number;
  /** Gate for the (slower, project-wide) TypeScript checker. */
  typescript: boolean;
  /** Extra consumer-defined providers, merged over the built-ins. */
  providers?: DeclarativeProvider[];
}
