export class VM {
  constructor() {
    this.stack = [];
    this.vars = new Map();
    this.output = [];
    this.pc = 0;
  }

  run(program) {
    throw new Error('not implemented');
  }
}
