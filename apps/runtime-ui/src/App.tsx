import { AppShell, Badge, Group, NavLink, Text, Title } from '@mantine/core';
import {
  IconActivity,
  IconBook,
  IconCoin,
  IconCpu,
  IconLayoutDashboard,
} from '@tabler/icons-react';
import {
  NavLink as RouterNavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useRuntimeState } from './api/hooks';
import { DashboardPage } from './pages/DashboardPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { MessageCostPage } from './pages/MessageCostPage';
import { ModelsPage } from './pages/ModelsPage';
import { UsagePage } from './pages/UsagePage';
import { WorkstreamDetailPage } from './pages/WorkstreamDetailPage';
import { WorkstreamsPage } from './pages/WorkstreamsPage';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/workstreams', label: 'Workstreams', icon: IconActivity },
  { to: '/memories', label: 'Memories', icon: IconBook },
  { to: '/usage', label: 'Usage', icon: IconCoin },
  { to: '/models', label: 'Models', icon: IconCpu },
];

export function App() {
  const { data: state } = useRuntimeState();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>{state?.agentName ?? 'Artificer'} Runtime</Title>
          <Group gap="xs">
            {state?.busy ? (
              <Badge color="blue" variant="dot">
                working · {state.queue.running} running / {state.queue.pending} queued
              </Badge>
            ) : (
              <Badge color="gray" variant="dot">
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
        <Text size="xs" c="dimmed" mt="md" px="sm">
          {state?.workstreams.length ?? 0} workstream(s)
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workstreams" element={<WorkstreamsPage />} />
          <Route path="/workstreams/:id" element={<WorkstreamDetailPage />} />
          <Route path="/memories" element={<MemoriesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/messages/:id/cost" element={<MessageCostPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
