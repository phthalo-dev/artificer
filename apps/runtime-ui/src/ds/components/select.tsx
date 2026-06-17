import { type ReactNode } from 'react';
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header,
  Popover,
  Select as AriaSelect,
  SelectValue,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const selectCls = {
  root: styles.class('nb-select-root', { display: 'flex', flexDirection: 'column', gap: space.xs }),
  label: styles.class('nb-select-label', { fontSize: font.sizeSm, fontWeight: font.w600, display: 'block' }),
  trigger: styles.class('nb-select-trigger', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    padding: `${space.xs} ${space.sm}`,
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `2px 2px 0 0 ${color.border}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    minWidth: '200px',
    width: '100%',
    '&[data-hovered]': { background: color.grayLight },
    '&[data-focused]': { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  }),
  popover: styles.class('nb-select-popover', {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `4px 4px 0 0 ${color.border}`,
    animation: 'nb-fadein 120ms ease',
    minWidth: 'var(--trigger-width)',
    zIndex: 1000,
    maxHeight: '300px',
    overflow: 'auto',
  }),
  item: styles.class('nb-select-item', {
    padding: `${space.xs} ${space.sm}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    outline: 'none',
    '&[data-focused]': { background: color.grayLight },
    '&[data-selected]': { background: color.border, color: color.bg },
  }),
  section: styles.class('nb-select-section', {
    padding: `${space.xs} ${space.sm}`,
    fontSize: font.sizeXs,
    fontWeight: font.w700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: color.dimmed,
    borderTop: `1px solid ${color.grayBg}`,
  }),
};

type SelectItem = { value: string; label: string };
type SelectGroup = { group: string; items: SelectItem[] };
type SelectData = (SelectItem | SelectGroup)[];

export type SelectProps = {
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string | null) => void;
  data: SelectData;
  searchable?: boolean;
  allowDeselect?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  renderOption?: (opts: { option: SelectItem }) => ReactNode;
  disabled?: boolean;
};

function isGroup(item: SelectItem | SelectGroup): item is SelectGroup {
  return 'group' in item;
}

export function Select({
  label,
  value,
  defaultValue,
  onChange,
  data,
  placeholder = 'Select…',
  renderOption,
  disabled,
  'aria-label': ariaLabel,
}: SelectProps) {
  const hasGroups = data.some(isGroup);

  return (
    <AriaSelect
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key) => onChange?.(key ? String(key) : null)}
      isDisabled={disabled}
      aria-label={ariaLabel}
      className={selectCls.root}
    >
      {label && <Label className={selectCls.label}>{label}</Label>}
      <AriaButton className={selectCls.trigger}>
        <SelectValue>{({ defaultChildren }) => defaultChildren ?? placeholder}</SelectValue>
        <span aria-hidden>▾</span>
      </AriaButton>
      <Popover className={selectCls.popover}>
        <ListBox>
          {hasGroups
            ? (data as SelectGroup[]).map((group) => (
                <ListBoxSection key={group.group}>
                  <Header className={selectCls.section}>{group.group}</Header>
                  {group.items.map((item) => (
                    <ListBoxItem key={item.value} id={item.value} textValue={item.label} className={selectCls.item}>
                      {renderOption ? renderOption({ option: item }) : item.label}
                    </ListBoxItem>
                  ))}
                </ListBoxSection>
              ))
            : (data as SelectItem[]).map((item) => (
                <ListBoxItem key={item.value} id={item.value} textValue={item.label} className={selectCls.item}>
                  {renderOption ? renderOption({ option: item }) : item.label}
                </ListBoxItem>
              ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
