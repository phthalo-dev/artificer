import type { ReactNode } from 'react';
import { Alert, Spinner } from '@var-ui/react';

/** Subset of the TanStack `useQuery` return that the panel needs. */
interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Loading/error shell for query-backed panels: a spinner while loading, a
 * danger Alert on failure, otherwise the children render-prop with the data.
 * `noun` (e.g. "trace") drives the spinner and error copy.
 */
export function QueryPanel<T>({
  query,
  noun,
  errorFallback,
  children,
}: {
  query: QueryState<T>;
  noun: string;
  /** Body shown when the failure carries no Error message. Defaults to "<Noun> unavailable". */
  errorFallback?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) {
    return <Spinner size="sm" label={`Loading ${noun}`} />;
  }
  if (query.error || query.data === undefined) {
    const fallback =
      errorFallback ??
      `${noun.charAt(0).toUpperCase()}${noun.slice(1)} unavailable`;
    return (
      <Alert tone="danger" title={`Could not load ${noun}`}>
        {query.error instanceof Error ? query.error.message : fallback}
      </Alert>
    );
  }
  return <>{children(query.data)}</>;
}
