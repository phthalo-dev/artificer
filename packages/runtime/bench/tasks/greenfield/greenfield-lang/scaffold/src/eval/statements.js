import { Environment } from '../environment.js';
import { evaluateExpression } from './expressions.js';
import { UserFunction, ReturnSignal } from '../callable.js';
import { isTruthy } from '../values.js';

export function executeStatement(node, env, interpreter) {
  throw new Error('not implemented');
}
