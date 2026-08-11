export function makeState(tokens) {
  return { tokens, pos: 0 };
}

export function peek(state) {
  return state.tokens[state.pos];
}

export function advance(state) {
  const t = state.tokens[state.pos];
  if (t.type !== 'EOF') state.pos += 1;
  return t;
}

export function check(state, type) {
  return peek(state).type === type;
}

export function expect(state, type) {
  const t = peek(state);
  if (t.type !== type) {
    throw new Error(`expected ${type} but got ${t.type} at line ${t.line}`);
  }
  return advance(state);
}
