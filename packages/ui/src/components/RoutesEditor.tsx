import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '../ds';
import { notifications } from '../ds/notifications';
import {
  IconArrowDown,
  IconArrowUp,
  IconDeviceFloppy,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuotaConfig, useUpdateQuotaConfig } from '../api/hooks';
import type {
  CatalogModel,
  ExecutionRouteConfig,
  ModelPresetInfo,
  ModelTier,
  QuotaConfig,
  QuotaWindowConfig,
} from '../api/types';

const TIERS: ModelTier[] = ['low', 'medium', 'high'];

function parseNum(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function priceLabel(model: CatalogModel | undefined): string {
  if (!model) return '';
  const { inputPerMTok: i, outputPerMTok: o } = model.pricing;
  if (i === 0 && o === 0) return 'free';
  return `in ${money(i)} · out ${money(o)} /Mtok`;
}

function RouteCard({
  route,
  index,
  total,
  presets,
  selectData,
  byId,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  route: ExecutionRouteConfig;
  index: number;
  total: number;
  presets: ModelPresetInfo[];
  selectData: Array<{
    group: string;
    items: { value: string; label: string }[];
  }>;
  byId: Map<string, CatalogModel>;
  onChange: (next: ExecutionRouteConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const usesLlm = route.execution === 'llm';

  const optionsFor = (current: string) => {
    if (byId.has(current)) return selectData;
    return [
      { group: 'Current', items: [{ value: current, label: current }] },
      ...selectData,
    ];
  };

  const updateWindow = (wi: number, patch: Partial<QuotaWindowConfig>) => {
    onChange({
      ...route,
      windows: route.windows.map((w, i) => (i === wi ? { ...w, ...patch } : w)),
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...route,
      presetId,
      models: { ...preset.tiers },
      roleTiers: { ...preset.roleTiers },
    });
  };

  const updateTier = (tier: ModelTier, modelId: string) => {
    onChange({
      ...route,
      presetId: 'custom',
      models: { ...route.models, [tier]: modelId },
    });
  };

  return (
    <Card padding="md" withBorder>
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Badge variant="filled" color={index === 0 ? 'blue' : 'gray'}>
            {index === 0 ? 'primary' : `failover ${index}`}
          </Badge>
          <Text fw={600}>{route.id}</Text>
          <Badge variant="outline">{route.accountId}</Badge>
          <Badge variant="outline">{route.mode}</Badge>
        </Group>
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            isDisabled={index === 0}
            onPress={onMoveUp}
            aria-label="Move route up"
          >
            <IconArrowUp size={16} />
          </Button>
          <Button
            size="xs"
            variant="subtle"
            isDisabled={index >= total - 1}
            onPress={onMoveDown}
            aria-label="Move route down"
          >
            <IconArrowDown size={16} />
          </Button>
          {index > 0 && (
            <Button
              size="xs"
              variant="subtle"
              onPress={onRemove}
              aria-label="Remove route"
            >
              <IconTrash size={16} />
            </Button>
          )}
        </Group>
      </Group>

      <Group grow align="flex-start" mb="md">
        <TextInput
          label="Route id"
          value={route.id}
          onChange={(v) => onChange({ ...route, id: v })}
        />
        <TextInput
          label="Quota account id"
          value={route.accountId}
          onChange={(v) => onChange({ ...route, accountId: v })}
        />
        <Select
          label="Execution"
          data={[
            { value: 'llm', label: 'LLM (internal loop)' },
            { value: 'cursor-agent', label: 'Cursor agent' },
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'opencode', label: 'opencode' },
          ]}
          value={route.execution}
          onChange={(v) => {
            const execution = (v as ExecutionRouteConfig['execution']) ?? 'llm';
            onChange({
              ...route,
              execution,
              ...(execution !== 'llm' ? { llm: undefined } : {}),
            });
          }}
        />
      </Group>

      {usesLlm ? (
        <>
          <TextInput
            label="Provider base URL"
            value={route.llm?.baseURL ?? ''}
            onChange={(v) =>
              onChange({
                ...route,
                llm: { ...route.llm, baseURL: v },
              })
            }
          />

          <Group align="flex-end" mt="md" mb="sm">
            <Select
              label="Model preset"
              data={[
                { value: 'custom', label: 'Custom tiers' },
                ...presets.map((p) => ({ value: p.id, label: p.name })),
              ]}
              value={route.presetId ?? 'custom'}
              onChange={(v) => {
                if (!v || v === 'custom') {
                  onChange({ ...route, presetId: 'custom' });
                } else {
                  applyPreset(v);
                }
              }}
            />
            {route.presetId === 'custom' && (
              <Badge size="sm" variant="light">
                custom tiers
              </Badge>
            )}
          </Group>

          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tier</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Provider</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {TIERS.map((tier) => {
                const selected = byId.get(route.models[tier]);
                return (
                  <Table.Tr key={tier}>
                    <Table.Td>
                      <Text fw={500} tt="capitalize">
                        {tier}
                      </Text>
                    </Table.Td>
                    <Table.Td style={{ minWidth: 260 }}>
                      <Select
                        aria-label={`${route.id} ${tier} model`}
                        data={optionsFor(route.models[tier])}
                        value={route.models[tier]}
                        searchable
                        allowDeselect={false}
                        onChange={(value) => value && updateTier(tier, value)}
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
                      <Text size="sm">{selected?.provider ?? '—'}</Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </>
      ) : (
        <Text size="sm" c="dimmed" mt="md">
          Agent executors run work directly — model presets and tier models do
          not apply on this route.
        </Text>
      )}

      <Text size="sm" fw={600} mt="lg" mb={6}>
        Quota windows
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Window</Table.Th>
            <Table.Th>Limit</Table.Th>
            <Table.Th>Warn %</Table.Th>
            <Table.Th>Block %</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {route.windows.map((window, wi) => (
            <Table.Tr key={window.id}>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {window.id}
                </Text>
                <Text size="xs" c="dimmed">
                  {window.period} · {window.unit}
                </Text>
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${window.id} limit`}
                  type="number"
                  value={String(window.limit)}
                  onChange={(v) =>
                    updateWindow(wi, { limit: parseNum(v, window.limit) })
                  }
                />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${window.id} warn`}
                  type="number"
                  value={String(window.warnAtPercent ?? 70)}
                  onChange={(v) =>
                    updateWindow(wi, {
                      warnAtPercent: parseNum(v, window.warnAtPercent ?? 70),
                    })
                  }
                />
              </Table.Td>
              <Table.Td>
                <TextInput
                  aria-label={`${window.id} block`}
                  type="number"
                  value={String(window.blockAtPercent ?? 90)}
                  onChange={(v) =>
                    updateWindow(wi, {
                      blockAtPercent: parseNum(v, window.blockAtPercent ?? 90),
                    })
                  }
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

export function RoutesEditor() {
  const { data, isLoading } = useQuotaConfig();
  const update = useUpdateQuotaConfig();
  const [draft, setDraft] = useState<QuotaConfig | null>(null);

  useEffect(() => {
    if (!data?.effective?.routes?.length) return;
    const base = data.configured?.routes?.length
      ? data.configured
      : data.effective;
    setDraft(structuredClone(base));
  }, [data]);

  const source = data?.configured?.routes?.length
    ? data.configured
    : (data?.effective ?? null);

  const dirty = useMemo(() => {
    if (!draft || !source) return false;
    return JSON.stringify(draft) !== JSON.stringify(source);
  }, [draft, source]);

  const catalog = data?.catalog ?? [];
  const presets = data?.presets ?? [];

  const byId = useMemo(() => {
    const map = new Map<string, CatalogModel>();
    for (const m of catalog) map.set(m.id, m);
    return map;
  }, [catalog]);

  const selectData = useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const m of catalog) {
      const items = groups.get(m.provider) ?? [];
      items.push({ value: m.id, label: m.id });
      groups.set(m.provider, items);
    }
    return [...groups.entries()].map(([group, items]) => ({ group, items }));
  }, [catalog]);

  if (isLoading || !data) return null;

  if (!draft?.routes?.length) {
    return (
      <Text c="dimmed" size="sm">
        No routes configured. Set <Code>QUOTA_DAILY_BUDGET_USD</Code> or add
        routes via <Code>artificer.config.json</Code>.
      </Text>
    );
  }

  const save = async () => {
    try {
      await update.mutateAsync({
        reservePercent: draft.reservePercent,
        routes: draft.routes,
      });
      notifications.show({
        title: 'Routes saved',
        message: 'Execution chain and quotas updated for subsequent runs.',
        color: 'green',
      });
    } catch (err) {
      notifications.show({
        title: 'Save failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    }
  };

  const moveRoute = (from: number, to: number) => {
    if (!draft.routes) return;
    const routes = [...draft.routes];
    const [item] = routes.splice(from, 1);
    routes.splice(to, 0, item!);
    setDraft({ ...draft, routes });
  };

  const addFailoverRoute = () => {
    const primary = draft.routes![0]!;
    const id = `failover-${draft.routes!.length}`;
    const newRoute: ExecutionRouteConfig = {
      id,
      accountId: `account-${draft.routes!.length}`,
      mode: 'metered',
      windows: [
        {
          id: 'daily-budget',
          unit: 'dollars',
          period: 'daily',
          scope: 'global',
          limit: 10,
          warnAtPercent: 70,
          blockAtPercent: 90,
        },
      ],
      execution: 'llm',
      llm: { baseURL: primary.llm?.baseURL ?? '' },
      presetId: primary.presetId ?? 'custom',
      models: { ...primary.models },
      roleTiers: primary.roleTiers ? { ...primary.roleTiers } : undefined,
    };
    setDraft({ ...draft, routes: [...draft.routes!, newRoute] });
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <TextInput
          label="Communicator reserve (%)"
          type="number"
          value={String(draft.reservePercent ?? 10)}
          onChange={(v) =>
            setDraft({
              ...draft,
              reservePercent: parseNum(v, draft.reservePercent ?? 10),
            })
          }
        />
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            isDisabled={!dirty || update.isPending}
            onPress={() => source && setDraft(structuredClone(source))}
          >
            Reset
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            loading={update.isPending}
            isDisabled={!dirty}
            onPress={save}
          >
            Save routes
          </Button>
        </Group>
      </Group>

      {!data.configured?.routes?.length && (
        <Text size="xs" c="dimmed">
          Showing auto-detected defaults. Saving writes an explicit route chain
          to config.
        </Text>
      )}

      {draft.routes.map((route, index) => (
        <RouteCard
          key={`${route.id}-${index}`}
          route={route}
          index={index}
          total={draft.routes!.length}
          presets={presets}
          selectData={selectData}
          byId={byId}
          onChange={(next) =>
            setDraft({
              ...draft,
              routes: draft.routes!.map((r, i) => (i === index ? next : r)),
            })
          }
          onMoveUp={() => moveRoute(index, index - 1)}
          onMoveDown={() => moveRoute(index, index + 1)}
          onRemove={() =>
            setDraft({
              ...draft,
              routes: draft.routes!.filter((_, i) => i !== index),
            })
          }
        />
      ))}

      <Button
        variant="light"
        leftSection={<IconPlus size={16} />}
        onPress={addFailoverRoute}
      >
        Add failover route
      </Button>
    </Stack>
  );
}
