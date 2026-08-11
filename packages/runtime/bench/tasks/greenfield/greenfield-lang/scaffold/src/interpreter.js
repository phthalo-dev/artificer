import { Environment } from './environment.js';
import { installBuiltins } from './builtins.js';
import { evaluateExpression } from './eval/expressions.js';
import { executeStatement } from './eval/statements.js';

export class Interpreter {
  constructor() {
    this.output = [];
    this.globals = new Environment(null);
    installBuiltins(this.globals, this);
  }

  evaluate(node, env) {
    return evaluateExpression(node, env, this);
  }

  execute(node, env) {
    return executeStatement(node, env, this);
  }

  run(program) {
    for (const stmt of program) {
      this.execute(stmt, this.globals);
    }
    return this.output;
  }
}
