export class Table {
  constructor(schema) {
    this.schema = schema;
    this.rows = [];
    this.nextId = 1;
  }

  insert(row) {
    throw new Error('not implemented');
  }

  all() {
    throw new Error('not implemented');
  }

  find(predicate) {
    throw new Error('not implemented');
  }
}
