export class JobQueue {
  constructor() {
    this.items = [];
  }

  enqueue(job) {
    throw new Error('not implemented');
  }

  dequeue() {
    throw new Error('not implemented');
  }

  peek() {
    throw new Error('not implemented');
  }

  get size() {
    throw new Error('not implemented');
  }

  isEmpty() {
    throw new Error('not implemented');
  }
}
