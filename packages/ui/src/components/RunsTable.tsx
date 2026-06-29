import { Code, Table, Text } from '../ds';
import type { RunRecord } from '../api/types';
import { formatCost, formatTokens, relativeTime } from '../format';
import { costForRun } from '../cost';
import { StatusBadge } from './StatusBadge';

export function RunsTable({ runs }: { runs: RunRecord[] }) {
  if (runs.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No runs yet.
      </Text>
    );
  }
  return (
    <Table.ScrollContainer minWidth={680}>
      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Role</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Model</Table.Th>
            <Table.Th>Tokens (in/out)</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>When</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((run) => (
            <Table.Tr key={run.id}>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {run.role}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1} maw={260}>
                  {run.task}
                </Text>
              </Table.Td>
              <Table.Td>
                <StatusBadge status={run.status} />
                {run.error && (
                  <Text size="xs" c="red" lineClamp={1} maw={220}>
                    {run.error}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {run.executor
                  ? <Code>{run.executor}</Code>
                  : run.model
                    ? <Code>{run.model}</Code>
                    : <Text size="xs" c="dimmed">—</Text>}
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {formatTokens(run.usage.inputTokens)} /{' '}
                  {formatTokens(run.usage.outputTokens)}
                </Text>
              </Table.Td>
              <Table.Td>{formatCost(costForRun(run))}</Table.Td>
              <Table.Td>
                <Text size="xs">{relativeTime(run.createdAt)}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
