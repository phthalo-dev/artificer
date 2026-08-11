export class Environment {
  constructor(parent) {
    this.parent = parent ?? null;
    this.values = new Map();
  }

  define(name, value) {
    throw new Error('not implemented');
  }

  get(name) {
    throw new Error('not implemented');
  }

  set(name, value) {
    throw new Error('not implemented');
  }
}
