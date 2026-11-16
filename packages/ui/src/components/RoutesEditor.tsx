import {
  Badge,
  Button,
  Card,
  Code,
  HStack,
  IconButton,
  Select,
  Stack,
  Table,
  Text,
  TextField,
  toast,
} from '@var-ui/react';
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
import { EXECUTOR_LABELS } from '../format-agent';
import type {
  CatalogModel,
  ExecutionRouteConfig,
  ModelPresetInfo,
  ModelTier,
  QuotaConfig,
  QuotaWindowConfig,
} from '../api/types';
import {
  capitalize,
  fill,
  modelCell,
  modelGroupLabel,
  modelOptionRow,
} from './RoutesEditor.styles';

const TIERS: ModelTier[] = ['low', 'medium', 'high'];

const EXECUTION_OPTIONS = Object.entries(EXECUTOR_LABELS).map(
  ([value, label]) => ({ value, label }),
);

type ModelGroup = {
  group: string;
  items: { value: string; label: string }[];
};

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

/**
 * Model picker. Var UI's `Select` has no option sections, so the provider
 * group is shown as a muted prefix on each row instead of a section header.
 */
function ModelSelect({
  ariaLabel,
  value,
  groups,
  byId,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  groups: ModelGroup[];
  byId: Map<string, CatalogModel>;
  onChange: (modelId: string) => void;
}) {
  return (
    <Select.Root
      aria-label={ariaLabel}
      value={value}
      onValueChange={(v) => v && onChange(v)}
    >
      <Select.Trigger>
        <Select.Value>{({ selectedText }) => selectedText}</Select.Value>
      </Select.Trigger>
      <Select.Popover>
        <Select.ListBox>
          {groups.flatMap((g) =>
            g.items.map((item) => (
              <Select.Item
                key={item.value}
                value={item.value}
                textValue={item.label}
              >
                <span className={modelOptionRow}>
                  <Text as="span" size="sm">
                    <span className={modelGroupLabel}>{g.group} /</span>
                    {item.label}
                  </Text>
                  <Text as="span" size="xs" tone="secondary">
                    {priceLabel(byId.get(item.value))}
                  </Text>
                </span>
              </Select.Item>
            )),
          )}
        </Select.ListBox>
      </Select.Popover>
    </Select.Root>
  );
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
  selectData: ModelGroup[];
  byId: Map<string, CatalogModel>;
  onChange: (next: ExecutionRouteConfig) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const usesLlm = route.execution === 'llm';

  const optionsFor = (current: string): ModelGroup[] => {
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
    <Card>
      <Stack gap="md">
        <HStack justify="between">
          <HStack gap="xs">
            <Badge appearance="solid" tone={index === 0 ? 'info' : 'neutral'}>
              {index === 0 ? 'primary' : `failover ${index}`}
            </Badge>
            <Text as="span" weight="semibold">
              {route.id}
            </Text>
            <Badge appearance="outline">{route.accountId}</Badge>
            <Badge appearance="outline">{route.mode}</Badge>
          </HStack>
          <HStack gap="xs">
            <IconButton
              size="sm"
              appearance="ghost"
              disabled={index === 0}
              onClick={onMoveUp}
              aria-label="Move route up"
              icon={<IconArrowUp size={16} />}
            />
            <IconButton
              size="sm"
              appearance="ghost"
              disabled={index >= total - 1}
              onClick={onMoveDown}
              aria-label="Move route down"
              icon={<IconArrowDown size={16} />}
            />
            {index > 0 && (
              <IconButton
                size="sm"
                appearance="ghost"
                onClick={onRemove}
                aria-label="Remove route"
                icon={<IconTrash size={16} />}
              />
            )}
          </HStack>
        </HStack>

        <HStack align="start">
          <TextField
            className={fill}
            label="Route id"
            value={route.id}
            onValueChange={(v) => onChange({ ...route, id: v })}
          />
          <TextField
            className={fill}
            label="Quota account id"
            value={route.accountId}
            onValueChange={(v) => onChange({ ...route, accountId: v })}
          />
          <Select
            className={fill}
            label="Execution"
            options={EXECUTION_OPTIONS}
            value={route.execution}
            onValueChange={(v) => {
              const execution =
                (v as ExecutionRouteConfig['execution'] | null) ?? 'llm';
              onChange({
                ...route,
                execution,
                ...(execution !== 'llm' ? { llm: undefined } : {}),
              });
            }}
          />
        </HStack>

        {usesLlm ? (
          <>
            <TextField
              label="Provider base URL"
              value={route.llm?.baseURL ?? ''}
              onValueChange={(v) =>
                onChange({
                  ...route,
                  llm: { ...route.llm, baseURL: v },
                })
              }
            />

            <HStack align="end">
              <Select
                label="Model preset"
                options={[
                  { value: 'custom', label: 'Custom tiers' },
                  ...presets.map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={route.presetId ?? 'custom'}
                onValueChange={(v) => {
                  if (!v || v === 'custom') {
                    onChange({ ...route, presetId: 'custom' });
                  } else {
                    applyPreset(v);
                  }
                }}
              />
              {route.presetId === 'custom' && <Badge>custom tiers</Badge>}
            </HStack>

            <Table hasHover>
              <Table.Header>
                <Table.Row>
                  <Table.Column>Tier</Table.Column>
                  <Table.Column>Model</Table.Column>
                  <Table.Column>Provider</Table.Column>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {TIERS.map((tier) => {
                  const selected = byId.get(route.models[tier]);
                  return (
                    <Table.Row key={tier}>
                      <Table.Cell>
                        <Text weight="medium" className={capitalize}>
                          {tier}
                        </Text>
                      </Table.Cell>
                      <Table.Cell className={modelCell}>
                        <ModelSelect
                          ariaLabel={`${route.id} ${tier} model`}
                          value={route.models[tier]}
                          groups={optionsFor(route.models[tier])}
                          byId={byId}
                          onChange={(modelId) => updateTier(tier, modelId)}
                        />
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="sm">{selected?.provider ?? '—'}</Text>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </>
        ) : (
          <Text size="sm" tone="secondary">
            Agent executors run work directly — model presets and tier models do
            not apply on this route.
          </Text>
        )}

        <Stack gap="xs">
          <Text size="sm" weight="semibold">
            Quota windows
          </Text>
          <Table hasHover>
            <Table.Header>
              <Table.Row>
                <Table.Column>Window</Table.Column>
                <Table.Column>Limit</Table.Column>
                <Table.Column>Warn %</Table.Column>
                <Table.Column>Block %</Table.Column>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {route.windows.map((window, wi) => (
                <Table.Row key={window.id}>
                  <Table.Cell>
                    <Text size="sm" weight="medium">
                      {window.id}
                    </Text>
                    <Text size="xs" tone="secondary">
                      {window.period} · {window.unit}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <TextField
                      aria-label={`${window.id} limit`}
                      type="number"
                      value={String(window.limit)}
                      onValueChange={(v) =>
                        updateWindow(wi, { limit: parseNum(v, window.limit) })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <TextField
                      aria-label={`${window.id} warn`}
                      type="number"
                      value={String(window.warnAtPercent ?? 70)}
                      onValueChange={(v) =>
                        updateWindow(wi, {
                          warnAtPercent: parseNum(
                            v,
                            window.warnAtPercent ?? 70,
                          ),
                        })
                      }
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <TextField
                      aria-label={`${window.id} block`}
                      type="number"
                      value={String(window.blockAtPercent ?? 90)}
                      onValueChange={(v) =>
                        updateWindow(wi, {
                          blockAtPercent: parseNum(
                            v,
                            window.blockAtPercent ?? 90,
                          ),
                        })
                      }
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Stack>
      </Stack>
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
      <Text tone="secondary" size="sm">
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
      toast({
        title: 'Routes saved',
        description: 'Execution chain and quotas updated for subsequent runs.',
        tone: 'success',
      });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : String(err),
        tone: 'danger',
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
      <HStack justify="between" align="end">
        <TextField
          label="Communicator reserve (%)"
          type="number"
          value={String(draft.reservePercent ?? 10)}
          onValueChange={(v) =>
            setDraft({
              ...draft,
              reservePercent: parseNum(v, draft.reservePercent ?? 10),
            })
          }
        />
        <HStack gap="xs">
          <Button
            appearance="subtle"
            disabled={!dirty || update.isPending}
            onClick={() => source && setDraft(structuredClone(source))}
          >
            <IconRefresh size={16} />
            Reset
          </Button>
          <Button
            tone="accent"
            appearance="filled"
            loading={update.isPending}
            disabled={!dirty}
            onClick={save}
          >
            <IconDeviceFloppy size={16} />
            Save routes
          </Button>
        </HStack>
      </HStack>

      {!data.configured?.routes?.length && (
        <Text size="xs" tone="secondary">
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

      <Button appearance="subtle" onClick={addFailoverRoute}>
        <IconPlus size={16} />
        Add failover route
      </Button>
    </Stack>
  );
}
