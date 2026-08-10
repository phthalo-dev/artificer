const VALID_PRIORITIES = ['low', 'medium', 'high'];

export class TaskStore {
  constructor() {
    this.tasks = [];
    this.nextId = 1;
  }

  add({ title, priority, tags } = {}) {
    throw new Error('not implemented');
  }

  get(id) {
    throw new Error('not implemented');
  }

  complete(id) {
    throw new Error('not implemented');
  }

  remove(id) {
    throw new Error('not implemented');
  }

  list({ priority, tag, done } = {}) {
    throw new Error('not implemented');
  }
}
