import { Link, Table, Text } from '@var-ui/react';
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
      <Text tone="secondary" size="sm">
        No data.
      </Text>
    );
  }
  return (
    <Table striped hasHover>
      <Table.Header>
        <Table.Row>
          <Table.Column rowHeader>{label}</Table.Column>
          <Table.Column>Calls</Table.Column>
          <Table.Column>In / Out tokens</Table.Column>
          <Table.Column>Cost</Table.Column>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map(([key, usage]) => {
          const rendered = renderKey?.(key) ?? { label: key };
          return (
            <Table.Row key={key}>
              <Table.Cell rowHeader>
                {rendered.to ? (
                  <Link href={rendered.to}>{rendered.label}</Link>
                ) : (
                  rendered.label
                )}
              </Table.Cell>
              <Table.Cell>{usage.runs}</Table.Cell>
              <Table.Cell>
                {formatTokens(usage.inputTokens)} /{' '}
                {formatTokens(usage.outputTokens)}
              </Table.Cell>
              <Table.Cell>{formatCost(usage.costUsd)}</Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table>
  );
}
