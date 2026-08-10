export function defineSchema(columns) {
  return {
    columns,
    validate(row) {
      throw new Error('not implemented');
    },
  };
}
