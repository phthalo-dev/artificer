import { type HTMLAttributes, type ReactNode, useState } from 'react';
import {
  Tab,
  TabList as AriaTabList,
  TabPanel,
  Tabs as AriaTabs,
} from 'react-aria-components';
import { cx } from '../styles';
import { tabs as tabsCls } from './tabs.styles';

export type TabsProps = {
  defaultValue?: string;
  value?: string;
  onTabChange?: (value: string) => void;
  keepMounted?: boolean;
  children: ReactNode;
  className?: string;
};

function TabsRoot({
  defaultValue = '',
  value,
  onTabChange,
  children,
  className,
}: TabsProps) {
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
  return (
    <AriaTabList className={cx(tabsCls.list, className)}>
      {children}
    </AriaTabList>
  );
}

type TabsTabProps = { value: string; children: ReactNode; className?: string };
function TabsTab({ value, children, className }: TabsTabProps) {
  return (
    <Tab id={value} className={cx(tabsCls.tab, className)}>
      {children}
    </Tab>
  );
}

type TabsPanelProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  pt?: string;
};
function TabsPanelComp({
  value,
  pt,
  className,
  style,
  children,
  ...props
}: TabsPanelProps) {
  return (
    <TabPanel
      id={value}
      className={cx(tabsCls.panel, className)}
      style={{ ...(pt ? { paddingTop: pt } : {}), ...style }}
      {...props}
    >
      {children}
    </TabPanel>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanelComp,
});
