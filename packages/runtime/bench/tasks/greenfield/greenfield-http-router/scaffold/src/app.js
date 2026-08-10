import { Router } from './router.js';
import { MiddlewareChain } from './middleware.js';
import { parsePath, parseQuery } from './request.js';
import { notFound, serverError } from './response.js';

export class App {
  constructor() {
    this.router = new Router();
    this.chain = new MiddlewareChain();
  }

  use(fn) {
    this.chain.use(fn);
  }

  get(path, handler) {
    this.router.route('GET', path, handler);
  }

  post(path, handler) {
    this.router.route('POST', path, handler);
  }

  async handle(rawRequest) {
    throw new Error('not implemented');
  }
}
