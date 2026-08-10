export class TTLCache {
  constructor(options = {}) {
    this.now = options.now ?? (() => Date.now());
    this.entries = new Map();
  }

  set(key, value, ttlMs) {
    throw new Error('not implemented');
  }

  get(key) {
    throw new Error('not implemented');
  }

  has(key) {
    throw new Error('not implemented');
  }

  delete(key) {
    throw new Error('not implemented');
  }

  get size() {
    throw new Error('not implemented');
  }
}
