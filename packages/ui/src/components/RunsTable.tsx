import { Code, Table, Text } from '@var-ui/react';
import type { RunRecord } from '../api/types';
import { formatCost, formatTokens, relativeTime } from '../format';
import { costForRun } from '../cost';
import { StatusBadge } from './StatusBadge';
import { runsTable } from './RunsTable.styles';

export function RunsTable({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) {
    return (
      <Text tone="secondary" size="sm">
        No runs yet.
      </Text>
    );
  }
  return (
    <Table striped hasHover className={runsTable}>
      <Table.Header>
        <Table.Row>
          <Table.Column rowHeader>Role</Table.Column>
          <Table.Column>Status</Table.Column>
          <Table.Column>Model</Table.Column>
          <Table.Column>Tokens (in/out)</Table.Column>
          <Table.Column>Cost</Table.Column>
          <Table.Column>When</Table.Column>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {runs.map((run) => (
          <Table.Row key={run.id}>
            <Table.Cell rowHeader>
              <Text size="sm" weight="semibold">
                {run.role}
              </Text>
              <Text
                size="xs"
                tone="secondary"
                lineClamp={1}
                style={{ maxWidth: 260 }}
              >
                {run.task}
              </Text>
            </Table.Cell>
            <Table.Cell>
              <StatusBadge status={run.status} />
              {run.error && (
                <Text
                  size="xs"
                  tone="danger"
                  lineClamp={1}
                  style={{ maxWidth: 220 }}
                >
                  {run.error}
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {run.executor ? (
                <Code>{run.executor}</Code>
              ) : run.model ? (
                <Code>{run.model}</Code>
              ) : (
                <Text as="span" size="xs" tone="secondary">
                  —
                </Text>
              )}
            </Table.Cell>
            <Table.Cell>
              {formatTokens(run.usage.inputTokens)} /{' '}
              {formatTokens(run.usage.outputTokens)}
            </Table.Cell>
            <Table.Cell>{formatCost(costForRun(run))}</Table.Cell>
            <Table.Cell>
              <Text as="span" size="xs">
                {relativeTime(run.createdAt)}
              </Text>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
