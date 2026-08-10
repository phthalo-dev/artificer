export class TokenBucket {
  constructor(options = {}) {
    const { capacity, refillPerMs } = options;
    this.capacity = capacity;
    this.refillPerMs = refillPerMs;
    this.now = options.now ?? (() => Date.now());
    this.tokens = capacity;
    this.lastRefillAt = this.now();
  }

  get available() {
    throw new Error('not implemented');
  }

  tryRemove(n = 1) {
    throw new Error('not implemented');
  }
}
