import { useState } from 'react';
import { AppShell, Badge, Button, Group, NavLink, Text, ThemeToggle, Title, headerInner, navFooter, space } from './ds';
import {
  IconActivity,
  IconBook,
  IconCoin,
  IconCpu,
  IconFlask,
  IconLayoutDashboard,
  IconMessage,
  IconLayoutSidebarRight,
  IconLayoutSidebarRightCollapse,
} from '@tabler/icons-react';
import { Navigate, NavLink as RouterNavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useRuntimeState } from './api/hooks';

const MOCK_MODE = import.meta.env.VITE_MOCK_API === 'true';
import { ActivityFeed } from './components/ActivityFeed';
import { QuotaBanner } from './components/QuotaBanner';
import { BenchPage } from './pages/BenchPage';
import { BenchRunPage } from './pages/BenchRunPage';
import { DashboardPage } from './pages/DashboardPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { MessagesPage } from './pages/MessagesPage';
import { MessageCostPage } from './pages/MessageCostPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { UsagePage } from './pages/UsagePage';
import { WorkstreamDetailPage } from './pages/WorkstreamDetailPage';
import { WorkstreamsPage } from './pages/WorkstreamsPage';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/messages', label: 'Messages', icon: IconMessage },
  { to: '/workstreams', label: 'Workstreams', icon: IconActivity },
  { to: '/bench', label: 'Benchmark', icon: IconFlask },
  { to: '/memories', label: 'Memories', icon: IconBook },
  { to: '/usage', label: 'Usage', icon: IconCoin },
  { to: '/providers', label: 'Providers', icon: IconCpu },
];

export function App() {
  const { data: state } = useRuntimeState();
  const location = useLocation();
  const [asideOpen, setAsideOpen] = useState(true);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm' }}
      aside={{ width: 260, open: asideOpen }}
      padding="md"
    >
      <AppShell.Header>
        <Group className={headerInner} style={{ padding: `0 ${space.md}` }} justify="space-between">
          <Title order={4}>{state?.agentName ?? 'Artificer'} Runtime</Title>
          <Group gap="xs">
            {MOCK_MODE && (
              <Badge color="grape" variant="light">
                mock data
              </Badge>
            )}
            <Button
              variant="subtle"
              size="sm"
              onPress={() => setAsideOpen((o) => !o)}
              aria-label={asideOpen ? 'Hide activity' : 'Show activity'}
            >
              {asideOpen
                ? <IconLayoutSidebarRightCollapse size={18} />
                : <IconLayoutSidebarRight size={18} />}
            </Button>
            <ThemeToggle />
            <QuotaBanner />
            {state?.busy ? (
              <Badge color="blue" variant="light">
                working · {state.queue.running} running / {state.queue.pending} queued
              </Badge>
            ) : (
              <Badge color="gray" variant="light">
                idle
              </Badge>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {NAV.map((item) => {
          const active =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={active}
            />
          );
        })}
        <Text size="xs" c="dimmed" className={navFooter}>
          {state?.workstreams.length ?? 0} workstream(s)
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/workstreams" element={<WorkstreamsPage />} />
          <Route path="/workstreams/:id" element={<WorkstreamDetailPage />} />
          <Route path="/bench" element={<BenchPage />} />
          <Route path="/bench/:instanceId" element={<BenchRunPage />} />
          <Route path="/memories" element={<MemoriesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/providers" element={<ProvidersPage />} />
          <Route path="/models" element={<Navigate to="/providers" replace />} />
          <Route path="/messages/:id/cost" element={<MessageCostPage />} />
        </Routes>
      </AppShell.Main>

      {asideOpen && (
        <AppShell.Aside>
          <ActivityFeed />
        </AppShell.Aside>
      )}
    </AppShell>
  );
}
