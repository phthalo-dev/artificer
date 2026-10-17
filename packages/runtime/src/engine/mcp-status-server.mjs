#!/usr/bin/env node
/**
 * Minimal MCP stdio server that exposes a single `report_status` tool.
 *
 * Usage: node mcp-status-server.mjs <status-file-path>
 *   or:  ARTIFICER_STATUS_FILE=<path> node mcp-status-server.mjs
 *
 * When the executor calls `report_status`, the input is written as JSON to
 * the status file and a success response is returned. The calling executor
 * reads the file after the agent process exits.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const statusFile = process.argv[2] ?? process.env.ARTIFICER_STATUS_FILE;
if (!statusFile) {
  process.stderr.write(
    'mcp-status-server: status file path required as argv[2] or ARTIFICER_STATUS_FILE\n',
  );
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const TOOLS = [
  {
    name: 'report_status',
    description:
      'Report your task completion status to the Artificer orchestrator. ' +
      'Call this once when you are finished — done, blocked, or need more context. ' +
      'Workers call this. Reviewers should call submit_review instead.',
    inputSchema: {
      type: 'object',
      required: ['status', 'summary'],
      properties: {
        status: {
          type: 'string',
          enum: ['done', 'done_with_concerns', 'blocked', 'needs_context'],
          description:
            'done — task complete and verified; done_with_concerns — complete with caveats; blocked — stuck, cannot proceed; needs_context — missing information.',
        },
        summary: {
          type: 'string',
          description:
            'Brief summary of what was accomplished or why you are blocked.',
        },
        followUps: {
          type: 'string',
          description: 'Optional follow-up tasks or notes for the next worker.',
        },
      },
    },
  },
  {
    name: 'submit_review',
    description:
      'Record a code review verdict. Call this when you have finished reviewing ' +
      'the work. The orchestrator uses the approval decision to route next steps — ' +
      'approved moves to submit/done, rejected sends back to the worker.',
    inputSchema: {
      type: 'object',
      required: ['target', 'notes', 'approved'],
      properties: {
        target: {
          type: 'string',
          description:
            'What was reviewed (e.g. "work", "plan", or a file path).',
        },
        notes: {
          type: 'string',
          description: 'Review feedback grouped by severity.',
        },
        approved: {
          type: 'boolean',
          description: 'Whether the work is approved as-is.',
        },
        stage: {
          type: 'string',
          enum: ['plan', 'work'],
          description: 'Whether you reviewed the plan or the implemented work.',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'important', 'minor', 'none'],
          description:
            'Highest-severity issue found; "none" when nothing needs to change.',
        },
      },
    },
  },
  {
    name: 'publish_artifact',
    description:
      'Publish a workstream artifact to the Artificer orchestrator after this executor exits.',
    inputSchema: {
      type: 'object',
      required: ['key', 'name', 'content'],
      properties: {
        key: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
        contentType: { type: 'string' },
        description: { type: 'string' },
        metadata: {
          type: 'object',
          additionalProperties: {
            type: ['string', 'number', 'boolean'],
          },
        },
      },
    },
  },
];

rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'artificer-status', version: '1.0.0' },
      },
    });
  } else if (method === 'notifications/initialized') {
    // notification — no response
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  } else if (method === 'tools/call') {
    const { name, arguments: args } = params ?? {};
    if (name === 'publish_artifact') {
      try {
        const artifactFile = path.join(
          path.dirname(statusFile),
          '.artificer-artifacts.jsonl',
        );
        fs.appendFileSync(artifactFile, JSON.stringify(args ?? {}) + '\n');
      } catch (err) {
        process.stderr.write(
          `mcp-status-server: failed to append artifact: ${err}\n`,
        );
      }
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: 'Artifact queued for publishing.' }],
        },
      });
    } else if (name === 'report_status' || name === 'submit_review') {
      try {
        fs.writeFileSync(
          statusFile,
          JSON.stringify({ tool: name, ...(args ?? {}) }),
        );
      } catch (err) {
        process.stderr.write(
          `mcp-status-server: failed to write status file: ${err}\n`,
        );
      }
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text:
                name === 'submit_review'
                  ? 'Review recorded.'
                  : 'Status recorded.',
            },
          ],
        },
      });
    } else {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${name}` },
      });
    }
  } else if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
});
