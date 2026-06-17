import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '../ds';
import { notifications } from '../ds/notifications';
import { IconCheck, IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useApplyPreset, useModelConfig, useUpdateModels } from '../api/hooks';
import type {
  CatalogModel,
  ModelPresetInfo,
  ModelTier,
  ModelTiers,
  RoleName,
} from '../api/types';

const TIERS: ModelTier[] = ['low', 'medium', 'high'];

const TIER_BLURB: Record<ModelTier, string> = {
  low: 'Routing, comms, lightweight review.',
  medium: 'Planning and implementation.',
  high: 'Escalation only (orchestrator override).',
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

function PresetCard({
  preset,
  active,
  loading,
  onApply,
}: {
  preset: ModelPresetInfo;
  active: boolean;
  loading: boolean;
  onApply: () => void;
}) {
  return (
    <Card
      padding="md"
      style={{
        border: active ? '2px solid #2563eb' : '2px solid #000',
        background: active ? '#dbeafe' : undefined,
      }}
    >
      <Group justify="space-between" align="flex-start" mb={6}>
        <div>
          <Group gap="xs">
            <Text fw={600} size="sm">
              {preset.name}
            </Text>
            {active && (
              <Badge size="xs" color="blue" variant="filled">
                active
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {preset.description}
          </Text>
        </div>
        <Button
          size="xs"
          variant={active ? 'light' : 'filled'}
          loading={loading}
          isDisabled={active}
          onPress={onApply}
        >
          {active ? 'Active' : 'Apply'}
        </Button>
      </Group>
      <Text size="xs" ff="monospace" c="dimmed">
        {preset.tiers.low} / {preset.tiers.medium} / {preset.tiers.high}
      </Text>
    </Card>
  );
}

export function ModelsPage() {
  const { data, isLoading } = useModelConfig();
  const update = useUpdateModels();
  const applyPreset = useApplyPreset();
  const [draft, setDraft] = useState<ModelTiers | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<
    RoleName,
    ModelTier
  > | null>(null);

  useEffect(() => {
    if (data) {
      setDraft(data.tiers);
      setRoleDraft(data.roleTiers);
    }
  }, [data]);

  const byId = useMemo(() => {
    const map = new Map<string, CatalogModel>();
    for (const m of data?.catalog ?? []) map.set(m.id, m);
    return map;
  }, [data]);

  const selectData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const m of data?.catalog ?? []) {
      const items = groups.get(m.provider) ?? [];
      items.push({ value: m.id, label: m.id });
      groups.set(m.provider, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [data]);

  const rolesByTier = useMemo(() => {
    const map: Record<ModelTier, RoleName[]> = { low: [], medium: [], high: [] };
    for (const [role, tier] of Object.entries(roleDraft ?? {})) {
      map[tier as ModelTier].push(role as RoleName);
    }
    return map;
  }, [roleDraft]);

  if (isLoading || !data || !draft || !roleDraft) return <Loader size="sm" />;

  const tiersDirty = TIERS.some((t) => draft[t] !== data.tiers[t]);

  const optionsFor = (current: string) => {
    if (byId.has(current)) return selectData;
    return [{ group: 'Current', items: [{ value: current, label: current }] }, ...selectData];
  };

  const saveTiers = () => {
    update.mutate(draft, {
      onSuccess: () =>
        notifications.show({
          color: 'teal',
          icon: <IconCheck size={16} />,
          title: 'Models updated',
          message: 'New runs will use the updated tier models.',
        }),
      onError: (err) =>
        notifications.show({
          color: 'red',
          title: 'Update failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
    });
  };

  const apply = (presetId: string) => {
    applyPreset.mutate(presetId, {
      onSuccess: (res) => {
        setDraft(res.tiers);
        setRoleDraft(res.roleTiers);
        notifications.show({
          color: 'teal',
          icon: <IconCheck size={16} />,
          title: `${res.name} applied`,
          message: 'Tier models and role map updated for subsequent runs.',
        });
      },
      onError: (err) =>
        notifications.show({
          color: 'red',
          title: 'Preset failed',
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
    });
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Models</Title>
        <Text size="sm" c="dimmed" mt={4}>
          Pick a preset or tune tiers manually. Changes apply to runs started
          afterwards — no restart required.
        </Text>
      </div>

      <div>
        <Text fw={600} size="sm" style={{ marginBottom: 'var(--nb-space-sm)' }}>
          Presets
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {data.presets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              active={data.activePresetId === preset.id}
              loading={applyPreset.isPending}
              onApply={() => apply(preset.id)}
            />
          ))}
        </SimpleGrid>
        {data.activePresetId === 'custom' && (
          <Text size="xs" c="dimmed" mt={4}>
            Custom configuration (manual tier edits).
          </Text>
        )}
      </div>

      <Group justify="space-between" align="flex-end">
        <Text fw={600} size="sm">
          Tier models
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            isDisabled={!tiersDirty || update.isPending}
            onPress={() => setDraft(data.tiers)}
          >
            Reset
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={update.isPending}
            isDisabled={!tiersDirty}
            onPress={saveTiers}
          >
            Save tiers
          </Button>
        </Group>
      </Group>

      <Table highlightOnHover>
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
                  <Text fw={600} tt="capitalize">
                    {tier}
                  </Text>
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
        Startup default: MODEL_PRESET=async-economy. Bench: pnpm bench:swebench /
        pnpm bench:deepswe (results under bench/results/&lt;preset&gt;/&lt;suite&gt;).
      </Text>
    </Stack>
  );
}
