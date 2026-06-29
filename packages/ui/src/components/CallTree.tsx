import { Box, Code, Collapse, Group, Paper, Text, UnstyledButton } from '../ds';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { RunNode } from '../api/types';
import { formatCost, formatTokens } from '../format';
import { StatusBadge } from './StatusBadge';

function CallNode({ node, depth }: { node: RunNode; depth: number }) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(depth < 2);
  const { run, self, cumulative } = node;

  return (
    <Box style={{ marginLeft: depth * 16 }}>
      <Paper p="xs" style={{ marginBottom: 6 }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            {hasChildren ? (
              <UnstyledButton onPress={() => setOpen((o) => !o)}>
                {open ? (
                  <IconChevronDown size={16} />
                ) : (
                  <IconChevronRight size={16} />
                )}
              </UnstyledButton>
            ) : (
              <Box w={16} />
            )}
            <Text size="sm" fw={600}>
              {run.role}
            </Text>
            <StatusBadge status={run.status} />
            {(run.executor ?? run.model) && (
              <Code style={{ fontSize: 11 }}>{run.executor ?? run.model}</Code>
            )}
          </Group>
          <Group gap="md" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {formatTokens(self.inputTokens)}/{formatTokens(self.outputTokens)} tok
            </Text>
            <Text size="xs" title="cost of this call only">
              self {formatCost(self.costUsd)}
            </Text>
            <Text size="xs" fw={600} title="cost including all child calls">
              Σ {formatCost(cumulative.costUsd)}
            </Text>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" lineClamp={2} mt={4} style={{ marginLeft: 22 }}>
          {run.task}
        </Text>
        {run.error && (
          <Text size="xs" c="red" mt={2} style={{ marginLeft: 22 }}>
            {run.error}
          </Text>
        )}
      </Paper>
      {hasChildren && (
        <Collapse in={open}>
          {node.children.map((child) => (
            <CallNode key={child.run.id} node={child} depth={depth + 1} />
          ))}
        </Collapse>
      )}
    </Box>
  );
}

export function CallTree({ tree }: { tree: RunNode[] }) {
  if (tree.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No calls recorded for this message yet.
      </Text>
    );
  }
  return (
    <Box>
      {tree.map((node) => (
        <CallNode key={node.run.id} node={node} depth={0} />
      ))}
    </Box>
  );
}
