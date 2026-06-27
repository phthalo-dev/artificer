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
import { select as selectCls } from './select.styles';

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
        <SelectValue>
          {({ defaultChildren }) => defaultChildren ?? placeholder}
        </SelectValue>
        <span aria-hidden>▾</span>
      </AriaButton>
      <Popover className={selectCls.popover}>
        <ListBox>
          {hasGroups
            ? (data as SelectGroup[]).map((group) => (
                <ListBoxSection key={group.group}>
                  <Header className={selectCls.section}>{group.group}</Header>
                  {group.items.map((item) => (
                    <ListBoxItem
                      key={item.value}
                      id={item.value}
                      textValue={item.label}
                      className={selectCls.item}
                    >
                      {renderOption
                        ? renderOption({ option: item })
                        : item.label}
                    </ListBoxItem>
                  ))}
                </ListBoxSection>
              ))
            : (data as SelectItem[]).map((item) => (
                <ListBoxItem
                  key={item.value}
                  id={item.value}
                  textValue={item.label}
                  className={selectCls.item}
                >
                  {renderOption ? renderOption({ option: item }) : item.label}
                </ListBoxItem>
              ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
