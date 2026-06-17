import { type HTMLAttributes, type ReactNode, useState } from 'react';
import {
  Tab,
  TabList as AriaTabList,
  TabPanel,
  Tabs as AriaTabs,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const tabsCls = {
  root: styles.class('nb-tabs-root', { width: '100%' }),
  list: styles.class('nb-tabs-list', {
    display: 'flex',
    borderBottom: `2px solid ${color.border}`,
    gap: '0',
  }),
  tab: styles.class('nb-tabs-tab', {
    padding: `${space.sm} ${space.md}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    fontWeight: font.w600,
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    marginBottom: '-2px',
    outline: 'none',
    color: color.muted,
    transition: 'color 100ms, border-color 100ms',
    '&[data-selected]': { color: color.text, borderBottomColor: color.border },
    '&[data-hovered]':  { color: color.text, background: color.grayLight },
    '&[data-focused]':  { outline: `2px solid ${color.border}`, outlineOffset: '-2px' },
  }),
  panel: styles.class('nb-tabs-panel', { paddingTop: space.md, outline: 'none' }),
};

// Mantine-compatible Tabs API: <Tabs defaultValue><Tabs.List><Tabs.Tab value><Tabs.Panel value>

export type TabsProps = {
  defaultValue?: string;
  value?: string;
  onTabChange?: (value: string) => void;
  keepMounted?: boolean;
  children: ReactNode;
  className?: string;
};

function TabsRoot({ defaultValue = '', value, onTabChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const setSelected = (v: string) => {
    setInternal(v);
    onTabChange?.(v);
  };
  return (
    <AriaTabs
      selectedKey={selected}
      onSelectionChange={(key) => setSelected(String(key))}
      className={cx(tabsCls.root, className)}
    >
      {children}
    </AriaTabs>
  );
}

type TabsListProps = { children: ReactNode; className?: string };
function TabsList({ children, className }: TabsListProps) {
  return <AriaTabList className={cx(tabsCls.list, className)}>{children}</AriaTabList>;
}

type TabsTabProps = { value: string; children: ReactNode; className?: string };
function TabsTab({ value, children, className }: TabsTabProps) {
  return <Tab id={value} className={cx(tabsCls.tab, className)}>{children}</Tab>;
}

type TabsPanelProps = HTMLAttributes<HTMLDivElement> & { value: string; pt?: string };
function TabsPanelComp({ value, pt, className, style, children, ...props }: TabsPanelProps) {
  return (
    <TabPanel id={value} className={cx(tabsCls.panel, className)} style={{ ...(pt ? { paddingTop: pt } : {}), ...style }} {...props}>
      {children}
    </TabPanel>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanelComp,
});
