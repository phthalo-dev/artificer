import {
  Badge,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useModelConfig, useUpdateModels } from '../api/hooks';
import type {
  CatalogModel,
  ModelTier,
  ModelTiers,
  RoleName,
} from '../api/types';

const TIERS: ModelTier[] = ['low', 'medium', 'high'];

const TIER_BLURB: Record<ModelTier, string> = {
  low: 'Lightweight, conversational work.',
  medium: 'Coordination, review, and memory.',
  high: 'Heavy reasoning and the actual work.',
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function priceLabel(model: CatalogModel | undefined): string {
  if (!model) return 'unknown pricing';
  const { inputPerMTok: i, outputPerMTok: o } = model.pricing;
  if (i === 0 && o === 0) return 'free';
  return `in ${money(i)} · out ${money(o)} /Mtok`;
}

export function ModelsPage() {
  const { data, isLoading } = useModelConfig();
  const update = useUpdateModels();
  const [draft, setDraft] = useState<ModelTiers | null>(null);

  useEffect(() => {
    if (data) setDraft(data.tiers);
  }, [data]);

  const byId = useMemo(() => {
    const map = new Map<string, CatalogModel>();
    for (const m of data?.catalog ?? []) map.set(m.id, m);
    return map;
  }, [data]);

  // Group catalog options by provider for the dropdown.
  const selectData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const m of data?.catalog ?? []) {
      const items = groups.get(m.provider) ?? [];
      items.push({ value: m.id, label: m.id });
      groups.set(m.provider, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [data]);

  // Which roles run on each tier (inverts the role->tier mapping).
  const rolesByTier = useMemo(() => {
    const map: Record<ModelTier, RoleName[]> = { low: [], medium: [], high: [] };
    for (const [role, tier] of Object.entries(data?.roleTiers ?? {})) {
      map[tier as ModelTier].push(role as RoleName);
    }
    return map;
  }, [data]);

  if (isLoading || !data || !draft) return <Loader size="sm" />;

  const dirty = TIERS.some((t) => draft[t] !== data.tiers[t]);

  // Include the current value even if it isn't in the catalog (custom id).
  const optionsFor = (current: string) => {
    if (byId.has(current)) return selectData;
    return [{ group: 'Current', items: [{ value: current, label: current }] }, ...selectData];
  };

  const save = () => {
    update.mutate(draft, {
      onSuccess: () =>
        notifications.show({
          color: 'teal',
          icon: <IconCheck size={16} />,
          title: 'Models updated',
          message: 'New runs will use the updated models.',
        }),
      onError: (err) =>
        notifications.show({
          color: 'red',
          title: 'Update failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
    });
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={3}>Models</Title>
          <Text size="sm" c="dimmed">
            Pick a model per complexity tier. Changes apply to runs started
            afterwards — handy for testing different configurations.
          </Text>
        </div>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            disabled={!dirty || update.isPending}
            onClick={() => setDraft(data.tiers)}
          >
            Reset
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={update.isPending}
            disabled={!dirty}
            onClick={save}
          >
            Save
          </Button>
        </Group>
      </Group>

      <Table verticalSpacing="md" horizontalSpacing="lg" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tier</Table.Th>
            <Table.Th>Model</Table.Th>
            <Table.Th>Input $/Mtok</Table.Th>
            <Table.Th>Output $/Mtok</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {TIERS.map((tier) => {
            const selected = byId.get(draft[tier]);
            return (
              <Table.Tr key={tier}>
                <Table.Td>
                  <Group gap={6} mb={4}>
                    <Text fw={600} tt="capitalize">
                      {tier}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {TIER_BLURB[tier]}
                  </Text>
                  <Group gap={4} mt={6}>
                    {rolesByTier[tier].map((role) => (
                      <Badge key={role} size="xs" variant="light" radius="sm">
                        {role}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td style={{ minWidth: 280 }}>
                  <Select
                    aria-label={`${tier} tier model`}
                    data={optionsFor(draft[tier])}
                    value={draft[tier]}
                    searchable
                    allowDeselect={false}
                    onChange={(value) =>
                      value && setDraft({ ...draft, [tier]: value })
                    }
                    renderOption={({ option }) => (
                      <Group justify="space-between" wrap="nowrap" w="100%">
                        <Text size="sm">{option.label}</Text>
                        <Text size="xs" c="dimmed">
                          {priceLabel(byId.get(option.value))}
                        </Text>
                      </Group>
                    )}
                  />
                  {selected && (
                    <Text size="xs" c="dimmed" mt={4}>
                      {selected.provider}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {selected ? money(selected.pricing.inputPerMTok) : '—'}
                </Table.Td>
                <Table.Td>
                  {selected ? money(selected.pricing.outputPerMTok) : '—'}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>

      <Text size="xs" c="dimmed">
        Output tokens dominate agent cost, so the output price matters most. The
        currently active configuration is{' '}
        <Text span fw={600}>
          {data.tiers.low}
        </Text>{' '}
        /{' '}
        <Text span fw={600}>
          {data.tiers.medium}
        </Text>{' '}
        /{' '}
        <Text span fw={600}>
          {data.tiers.high}
        </Text>
        . Set defaults in the runtime's .env (LLM_MODEL_LOW / LLM_MODEL /
        LLM_MODEL_HIGH).
      </Text>
    </Stack>
  );
}
