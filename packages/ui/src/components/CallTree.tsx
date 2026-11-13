import { Code, HStack, Surface, Text } from '@var-ui/react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useState } from 'react';
import type { RunNode } from '../api/types';
import { formatCost, formatTokens } from '../format';
import { StatusBadge } from './StatusBadge';
import {
  callNode,
  detailLine,
  modelCode,
  rowMain,
  toggleButton,
  toggleSpacer,
} from './CallTree.styles';

function CallNode({ node, depth }: { node: RunNode; depth: number }) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(depth < 2);
  const { run, self, cumulative } = node;

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <Surface padding="sm" className={callNode}>
        <HStack justify="between" gap="xs">
          <HStack gap="xs" className={rowMain}>
            {hasChildren ? (
              <button
                type="button"
                className={toggleButton}
                aria-expanded={open}
                aria-label={
                  open ? 'Collapse child calls' : 'Expand child calls'
                }
                onClick={() => setOpen((o) => !o)}
              >
                {open ? (
                  <IconChevronDown size={16} />
                ) : (
                  <IconChevronRight size={16} />
                )}
              </button>
            ) : (
              <span className={toggleSpacer} />
            )}
            <Text as="span" size="sm" weight="semibold">
              {run.role}
            </Text>
            <StatusBadge status={run.status} />
            {(run.executor ?? run.model) && (
              <Code className={modelCode}>{run.executor ?? run.model}</Code>
            )}
          </HStack>
          <HStack gap="md">
            <Text as="span" size="xs" tone="secondary">
              {formatTokens(self.inputTokens)}/{formatTokens(self.outputTokens)}{' '}
              tok
            </Text>
            <Text as="span" size="xs" title="cost of this call only">
              self {formatCost(self.costUsd)}
            </Text>
            <Text
              as="span"
              size="xs"
              weight="semibold"
              title="cost including all child calls"
            >
              Σ {formatCost(cumulative.costUsd)}
            </Text>
          </HStack>
        </HStack>
        <Text size="xs" tone="secondary" lineClamp={2} className={detailLine}>
          {run.task}
        </Text>
        {run.error && (
          <Text size="xs" tone="danger" className={detailLine}>
            {run.error}
          </Text>
        )}
      </Surface>
      {hasChildren &&
        open &&
        node.children.map((child) => (
          <CallNode key={child.run.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

export function CallTree({ tree }: { tree: RunNode[] }) {
  if (tree.length === 0) {
    return (
      <Text tone="secondary" size="sm">
        No calls recorded for this message yet.
      </Text>
    );
  }
  return (
    <div>
      {tree.map((node) => (
        <CallNode key={node.run.id} node={node} depth={0} />
      ))}
    </div>
  );
}
