/** True when at least one outbound message contains the configured pattern. */
export function gradeMessageContains(
  outboundMessages: string[],
  pattern: string,
): boolean {
  return outboundMessages.some((message) => message.includes(pattern));
}

/** True when the workstream reached one of the configured statuses. */
export function gradeWorkstreamStatus(
  status: string,
  expect: string[],
): boolean {
  return expect.includes(status);
}
