import net from 'node:net';

export interface PortRange {
  min: number;
  max: number;
}

/**
 * Tracks ports claimed by services across all workstreams in this runtime
 * process and finds a free port within a configured range. Claims are
 * in-memory only; they're rebuilt from workstream state files on startup by
 * ServiceManager.reconcileAll.
 */
export class PortAllocator {
  private readonly claimed = new Set<number>();

  claim(port: number): void {
    this.claimed.add(port);
  }

  release(port: number): void {
    this.claimed.delete(port);
  }

  /**
   * Finds and claims the first free port in range, or throws.
   *
   * Claims the candidate port BEFORE probing it, releasing it again if the
   * probe fails. `claimed.add(port)` is synchronous and happens before the
   * only `await` in the loop body, so two concurrent callers whose loops
   * interleave always diverge onto different candidate ports before either
   * one awaits - whichever claims a given port first makes every other
   * concurrent caller's `claimed.has(port)` check (on its next iteration)
   * see it as taken. Without this, two callers could both pass the
   * `isPortFree` probe for the same port before either added it to
   * `claimed`, and both would return the same "free" port.
   */
  async allocate(range: PortRange): Promise<number> {
    for (let port = range.min; port <= range.max; port += 1) {
      if (this.claimed.has(port)) continue;
      this.claimed.add(port);
      if (await this.isPortFree(port)) {
        return port;
      }
      this.claimed.delete(port);
    }
    throw new Error(
      `No free port in range ${range.min}-${range.max} (all claimed or in use).`,
    );
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }
}
