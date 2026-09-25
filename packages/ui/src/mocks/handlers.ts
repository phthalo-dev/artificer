import type { RoleName } from '../api/types';
import { mockStore } from './store';

export interface MockRequest {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  body?: unknown;
}

export interface MockResponse {
  status: number;
  body?: unknown;
  contentType?: string;
  rawBody?: string;
}

function workstreamRoute(pathname: string): {
  id: string;
  subpath: string | null;
} | null {
  const match = pathname.match(/^\/workstreams\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return { id: match[1], subpath: match[2] ?? null };
}

function artifactRoute(subpath: string): {
  key: string;
  rest: string | null;
} | null {
  const match = subpath.match(/^artifacts\/([^/]+)(?:\/(.*))?$/);
  if (!match) return null;
  return { key: match[1], rest: match[2] ?? null };
}

export function handleMockRequest(req: MockRequest): MockResponse {
  const { method, pathname, searchParams, body } = req;

  if (method === 'GET' && pathname === '/state') {
    return { status: 200, body: mockStore.getState() };
  }

  if (method === 'GET' && pathname === '/messages') {
    return { status: 200, body: { messages: mockStore.messages } };
  }

  if (method === 'POST' && pathname === '/messages') {
    const content = (body as { content?: string })?.content;
    if (!content?.trim()) {
      return { status: 400, body: { error: 'content is required' } };
    }
    const message = mockStore.addMessage(content);
    return { status: 202, body: { message } };
  }

  if (
    method === 'GET' &&
    pathname.startsWith('/messages/') &&
    pathname.endsWith('/cost')
  ) {
    const id = pathname.slice('/messages/'.length, -'/cost'.length);
    const cost = mockStore.getMessageCost(id);
    if (!cost) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: cost };
  }

  if (method === 'GET' && pathname === '/workstreams') {
    return { status: 200, body: { workstreams: mockStore.workstreams } };
  }

  const wsRoute = workstreamRoute(pathname);
  if (wsRoute) {
    const { id, subpath } = wsRoute;

    if (method === 'GET' && subpath === null) {
      const detail = mockStore.workstreamDetails[id];
      if (!detail) return { status: 404, body: { error: 'not found' } };
      return { status: 200, body: detail };
    }

    if (method === 'GET' && subpath === 'trace') {
      const trace = mockStore.getWorkstreamTrace(id);
      if (!trace) return { status: 404, body: { error: 'trace not found' } };
      return { status: 200, body: trace };
    }

    if (method === 'GET' && subpath === 'receipt') {
      const receipt = mockStore.getWorkstreamReceipt(id);
      if (!receipt) return { status: 404, body: { error: 'not found' } };
      if (searchParams.get('format') === 'markdown') {
        return {
          status: 200,
          contentType: 'text/markdown; charset=utf-8',
          rawBody: receipt.markdown,
        };
      }
      return { status: 200, body: receipt };
    }

    if (subpath === 'artifacts' && method === 'GET') {
      return { status: 200, body: { artifacts: mockStore.listArtifacts(id) } };
    }

    if (subpath?.startsWith('artifacts/')) {
      const artifactPath = artifactRoute(subpath);
      if (!artifactPath) {
        return { status: 404, body: { error: 'not found' } };
      }
      const { key, rest } = artifactPath;

      if (method === 'GET' && rest === null) {
        const artifact = mockStore.getArtifact(id, key);
        if (!artifact) return { status: 404, body: { error: 'not found' } };
        return { status: 200, body: { artifact } };
      }

      if (rest === 'versions' && method === 'GET') {
        const artifact = mockStore.getArtifact(id, key);
        if (!artifact) return { status: 404, body: { error: 'not found' } };
        return { status: 200, body: { versions: artifact.versions } };
      }

      const versionContentMatch = rest?.match(/^versions\/([^/]+)\/content$/);
      if (method === 'GET' && versionContentMatch) {
        const version = versionContentMatch[1];
        const payload = mockStore.getArtifactContent(id, key, version);
        if (!payload) return { status: 404, body: { error: 'not found' } };
        return {
          status: 200,
          contentType: payload.contentType,
          rawBody: payload.content,
        };
      }

      const versionActionMatch = rest?.match(
        /^versions\/([^/]+)\/(request-approval|approve|release)$/,
      );
      if (method === 'POST' && versionActionMatch) {
        const version = versionActionMatch[1];
        const action = versionActionMatch[2];
        try {
          if (action === 'request-approval') {
            const artifact = mockStore.requestArtifactApproval(id, key);
            if (!artifact) return { status: 404, body: { error: 'not found' } };
            return { status: 200, body: { artifact } };
          }
          if (action === 'approve') {
            const artifact = mockStore.approveArtifactVersion(id, key, version);
            if (!artifact) return { status: 404, body: { error: 'not found' } };
            return { status: 200, body: { artifact } };
          }
          const artifact = mockStore.releaseArtifactVersion(id, key, version);
          if (!artifact) return { status: 404, body: { error: 'not found' } };
          return { status: 200, body: { artifact } };
        } catch (error) {
          return {
            status: 400,
            body: {
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }
    }

    if (method === 'POST' && subpath === 'cancel') {
      const ok = mockStore.cancelWorkstream(id);
      if (!ok) {
        return {
          status: 404,
          body: { error: 'not found or already terminal' },
        };
      }
      return { status: 200, body: { ok: true } };
    }
  }

  if (method === 'GET' && pathname === '/usage') {
    return { status: 200, body: mockStore.getUsageOverview() };
  }

  if (method === 'POST' && pathname === '/quota/reset') {
    const accountId = (body as { accountId?: string })?.accountId;
    const windowId = (body as { windowId?: string })?.windowId;
    if (!accountId || !windowId) {
      return {
        status: 400,
        body: { error: 'accountId and windowId are required' },
      };
    }
    const ok = mockStore.resetQuotaWindow(accountId, windowId);
    if (!ok) return { status: 404, body: { error: 'window not found' } };
    return {
      status: 200,
      body: { ok: true, quota: mockStore.getUsageOverview().quota },
    };
  }

  if (method === 'GET' && pathname === '/config/models') {
    return { status: 200, body: mockStore.modelConfig };
  }

  if (method === 'PUT' && pathname === '/config/models') {
    const tiers = body as Partial<typeof mockStore.modelConfig.tiers>;
    mockStore.modelConfig.tiers = { ...mockStore.modelConfig.tiers, ...tiers };
    mockStore.modelConfig.activePresetId = 'custom';
    return {
      status: 200,
      body: {
        tiers: mockStore.modelConfig.tiers,
        roleTiers: mockStore.modelConfig.roleTiers,
        activePresetId: mockStore.modelConfig.activePresetId,
      },
    };
  }

  if (method === 'PUT' && pathname === '/config/role-tiers') {
    const roleTiers = body as Partial<
      Record<RoleName, 'low' | 'medium' | 'high'>
    >;
    mockStore.modelConfig.roleTiers = {
      ...mockStore.modelConfig.roleTiers,
      ...roleTiers,
    };
    mockStore.modelConfig.activePresetId = 'custom';
    return {
      status: 200,
      body: {
        tiers: mockStore.modelConfig.tiers,
        roleTiers: mockStore.modelConfig.roleTiers,
        activePresetId: mockStore.modelConfig.activePresetId,
      },
    };
  }

  if (method === 'PUT' && pathname === '/config/preset') {
    const presetId = (body as { presetId?: string })?.presetId;
    const preset = mockStore.modelConfig.presets.find((p) => p.id === presetId);
    if (!preset) return { status: 400, body: { error: 'unknown preset' } };
    mockStore.modelConfig.tiers = { ...preset.tiers };
    mockStore.modelConfig.roleTiers = { ...preset.roleTiers };
    mockStore.modelConfig.activePresetId = preset.id;
    return {
      status: 200,
      body: {
        presetId: preset.id,
        name: preset.name,
        tiers: preset.tiers,
        roleTiers: preset.roleTiers,
        activePresetId: preset.id,
      },
    };
  }

  if (method === 'GET' && pathname === '/config/quota') {
    return { status: 200, body: mockStore.getQuotaConfig() };
  }

  if (method === 'PUT' && pathname === '/config/quota') {
    const config = body as import('../api/types').QuotaConfig;
    if (!config?.routes?.length && !config?.accounts?.length) {
      return { status: 400, body: { error: 'routes required' } };
    }
    const updated = mockStore.updateQuotaConfig(config);
    return {
      status: 200,
      body: { ...updated, quota: mockStore.getUsageOverview().quota },
    };
  }

  if (method === 'GET' && pathname === '/memories') {
    const q = searchParams.get('q')?.trim();
    const memories = q ? mockStore.searchMemories(q) : mockStore.memories;
    return { status: 200, body: { memories } };
  }

  if (method === 'POST' && pathname === '/memories') {
    const input = body as {
      content?: string;
      title?: string;
      summary?: string;
      tags?: string[];
      source?: string;
      kind?: 'note' | 'document' | 'preference' | 'claim' | 'entity';
    };
    if (!input.content?.trim()) {
      return { status: 400, body: { error: 'content is required' } };
    }
    const memory = mockStore.addMemory({
      content: input.content,
      title: input.title,
      summary: input.summary,
      tags: input.tags,
      source: input.source,
      kind: input.kind,
    });
    return { status: 201, body: { memory } };
  }

  if (method === 'DELETE' && pathname.startsWith('/memories/')) {
    const id = pathname.slice('/memories/'.length);
    const deleted = mockStore.deleteMemory(id);
    if (!deleted) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: { ok: true } };
  }

  if (method === 'GET' && pathname === '/bench/runs') {
    return { status: 200, body: mockStore.getBenchOverview() };
  }

  if (method === 'GET' && pathname === '/bench/suites') {
    return { status: 200, body: { suites: mockStore.getBenchSuites() } };
  }

  if (method === 'GET' && pathname.startsWith('/bench/runs/')) {
    const instanceId = pathname.slice('/bench/runs/'.length);
    const detail = mockStore.getBenchRun(instanceId);
    if (!detail) return { status: 404, body: { error: 'not found' } };
    return { status: 200, body: detail };
  }

  if (method === 'GET' && pathname === '/health') {
    return { status: 200, body: { ok: true, agent: 'Artificer (mock)' } };
  }

  return { status: 404, body: { error: 'not found', path: pathname } };
}
