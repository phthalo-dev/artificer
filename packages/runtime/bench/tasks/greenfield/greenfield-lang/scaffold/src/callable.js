export class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

export class UserFunction {
  constructor(declaration, closure) {
    this.declaration = declaration;
    this.closure = closure;
  }

  get arity() {
    return this.declaration.params.length;
  }
}

export class BuiltinFunction {
  constructor(name, arity, fn) {
    this.name = name;
    this.arity = arity;
    this.fn = fn;
  }
}
