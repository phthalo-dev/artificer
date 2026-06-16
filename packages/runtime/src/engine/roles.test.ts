import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getRole } from './roles.js';

test('worker verification guidance keeps throwaway debug scripts out of the repo', () => {
  const system = getRole('worker').system('TestAgent');

  assert.match(
    system,
    /\/tmp/,
    'expected guidance to write throwaway debug/check scripts to /tmp instead of the repo',
  );
  assert.match(
    system,
    /delete (it|them) before finishing/i,
    'expected guidance to delete stray debug files before finishing if created in the repo',
  );
});

test('worker scope guidance covers orphan cleanup and matching existing style', () => {
  const system = getRole('worker').system('TestAgent');

  assert.match(
    system,
    /unused/i,
    'expected guidance to remove imports/vars/functions the edit made unused',
  );
  assert.match(
    system,
    /match the existing style/i,
    'expected guidance to match existing style rather than reformatting adjacent code',
  );
});

test('reviewer code-quality lens flags ad-hoc conditionals bolted onto unrelated flows', () => {
  const system = getRole('reviewer').system('TestAgent');

  assert.match(
    system,
    /ad-hoc conditionals|special-case branches/i,
    'expected the code-quality lens to flag special-case branches bolted onto existing flows',
  );
});

test('worker reporting guidance asks for assumptions to be surfaced in followUps', () => {
  const system = getRole('worker').system('TestAgent');

  assert.match(
    system,
    /followUps:.*assumption/is,
    'expected followUps guidance to mention surfacing assumptions for the reviewer',
  );
});

test('communicator distinguishes facts from standing preferences when saving memories', () => {
  const system = getRole('communicator').system('TestAgent');

  assert.match(
    system,
    /kind:\s*["']preference["']/,
    'expected guidance to save standing corrections with kind: "preference"',
  );
  assert.match(
    system,
    /tag(ged)?[^.]*preference/i,
    'expected guidance to tag standing-preference memories for later recall',
  );
});

test('communicator routes [GitHub]-prefixed watcher messages to send_note or start_workstream', () => {
  const system = getRole('communicator').system('TestAgent');

  assert.match(system, /\[GitHub\]/, 'expected guidance to mention [GitHub]-prefixed messages');
  assert.match(
    system,
    /\[GitHub\][\s\S]*send_note/,
    'expected guidance for matching an existing workstream via send_note',
  );
  assert.match(
    system,
    /\[GitHub\][\s\S]*start_workstream/,
    'expected guidance for starting a new workstream on an actionable mention',
  );
});

test('worker and orchestrator guidance surfaces PR URLs into the workstream summary for the GitHub watcher', () => {
  const worker = getRole('worker').system('TestAgent');
  const orchestrator = getRole('orchestrator').system('TestAgent');

  assert.match(
    worker,
    /summary:[\s\S]*PR URL/i,
    'expected worker report_status summary guidance to mention including a PR URL',
  );
  assert.match(
    orchestrator,
    /update_status[\s\S]*PR URL/i,
    'expected orchestrator update_status guidance to mention recording the PR URL in the summary',
  );
});

test('planner checks for standing preference memories before planning', () => {
  const system = getRole('planner').system('TestAgent');

  assert.match(
    system,
    /query_memories/,
    'expected planner guidance to call query_memories',
  );
  assert.match(
    system,
    /tags:\s*\[["']preference["']\]/,
    'expected planner guidance to query for tags: ["preference"]',
  );
});
