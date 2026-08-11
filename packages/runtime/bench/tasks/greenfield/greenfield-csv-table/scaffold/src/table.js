export class Table {
  constructor(rows) {
    this.rows = rows;
  }

  filter(predicate) {
    throw new Error('not implemented');
  }

  sortBy(key, options = {}) {
    throw new Error('not implemented');
  }

  groupBy(key) {
    throw new Error('not implemented');
  }

  select(columns) {
    throw new Error('not implemented');
  }
}
