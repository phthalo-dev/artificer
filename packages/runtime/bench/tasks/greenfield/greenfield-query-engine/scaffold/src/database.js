import { Table } from './table.js';

export class Database {
  constructor() {
    this.tables = new Map();
  }

  createTable(name, schema) {
    throw new Error('not implemented');
  }

  table(name) {
    throw new Error('not implemented');
  }
}
