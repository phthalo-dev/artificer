import { Anchor, Table, Text } from '../ds';
import { Link } from 'react-router-dom';
import type { UsageSummary } from '../api/types';
import { formatCost, formatTokens } from '../format';

export interface BreakdownTableProps {
  label: string;
  data: Record<string, UsageSummary>;
  /** Optional map turning a key into a label + link target. */
  renderKey?: (key: string) => { label: string; to?: string };
}

export function BreakdownTable({
  label,
  data,
  renderKey,
}: BreakdownTableProps) {
  const rows = Object.entries(data).sort((a, b) => b[1].costUsd - a[1].costUsd);
  if (rows.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No data.
      </Text>
    );
  }
  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{label}</Table.Th>
          <Table.Th>Calls</Table.Th>
          <Table.Th>In / Out tokens</Table.Th>
          <Table.Th>Cost</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map(([key, usage]) => {
          const rendered = renderKey?.(key) ?? { label: key };
          return (
            <Table.Tr key={key}>
              <Table.Td>
                {rendered.to ? (
                  <Anchor component={Link} to={rendered.to} size="sm">
                    {rendered.label}
                  </Anchor>
                ) : (
                  <Text size="sm">{rendered.label}</Text>
                )}
              </Table.Td>
              <Table.Td>{usage.runs}</Table.Td>
              <Table.Td>
                {formatTokens(usage.inputTokens)} /{' '}
                {formatTokens(usage.outputTokens)}
              </Table.Td>
              <Table.Td>{formatCost(usage.costUsd)}</Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
