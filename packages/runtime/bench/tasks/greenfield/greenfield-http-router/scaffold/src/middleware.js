export class MiddlewareChain {
  constructor() {
    this.middlewares = [];
  }

  use(fn) {
    throw new Error('not implemented');
  }

  async run(ctx, finalHandler) {
    throw new Error('not implemented');
  }
}
