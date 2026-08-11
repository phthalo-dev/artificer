export class Router {
  constructor() {
    this.routes = [];
  }

  route(method, path, handler) {
    throw new Error('not implemented');
  }

  match(method, path) {
    throw new Error('not implemented');
  }
}
