/**
 * Host workspace paths use a `repo/` prefix (read_file, grep, edit_file).
 * Docker bench shells run in `/app` with the repo tree copied to the container
 * root — there is no `repo/` subdirectory inside the container.
 */

/** Rewrite host-style `repo/` paths for in-container shell execution. */
export function rewriteDockerShellCommand(command: string): string {
  let next = command;
  next = next.replace(/\bcd\s+repo\s*&&\s*/gi, '');
  next = next.replace(/\bcd\s+repo\s*;?\s*$/gi, 'pwd');
  next = next.replace(/\/app\/repo\//g, '/app/');
  next = next.replace(/\brepo\//g, '');
  return next;
}

/** Avoid leaking the full `docker exec -e ...` argv from execFile error messages. */
export function formatDockerExecFailure(err: {
  stdout?: string;
  stderr?: string;
  message: string;
}): string {
  const partial = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
  if (partial) {
    return `Command failed:\n${partial}`;
  }
  if (/docker exec/i.test(err.message)) {
    return (
      'Command failed: docker exec returned a non-zero exit code. ' +
      'Inside the evaluator container, paths are relative to /app (use src/..., not repo/src/).'
    );
  }
  return `Command failed:\n${err.message}`;
}
