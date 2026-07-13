export type ProviderKind = 'openrouter' | 'openai-compatible';
export type ReadinessBlockerCode = 'workspace_missing' | 'credential_missing' | 'credential_invalid' | 'provider_unreachable' | 'catalog_unavailable';

export interface ProviderReadiness {
  provider: ProviderKind;
  ready: boolean;
  workspaceOpen: boolean;
  credential: {
    required: boolean;
    configured: boolean;
    source: 'secret-storage' | 'environment' | 'not-required' | 'none';
    valid: boolean | null;
  };
  authentication: { status: 'pass' | 'fail' | 'skipped'; latencyMs: number };
  catalog: { status: 'live' | 'fallback' | 'error'; modelCount: number };
  blockers: Array<{ code: ReadinessBlockerCode; message: string }>;
  checkedAt: string;
}

export interface ReadinessProbeOptions {
  provider: ProviderKind;
  workspaceOpen: boolean;
  apiKey?: string;
  credentialSource?: 'secret-storage' | 'environment' | 'none';
  openAiCompatibleBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probeProviderReadiness(options: ReadinessProbeOptions): Promise<ProviderReadiness> {
  const checkedAt = new Date().toISOString();
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(500, Math.min(15_000, options.timeoutMs || 8_000));
  const blockers: ProviderReadiness['blockers'] = [];
  if (!options.workspaceOpen) blockers.push({ code: 'workspace_missing', message: 'Open a workspace folder before starting an agent run.' });

  if (options.provider === 'openai-compatible') {
    const started = Date.now();
    const baseUrl = String(options.openAiCompatibleBaseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
    try {
      const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/models`, { headers: { Accept: 'application/json' } }, timeoutMs);
      if (!response.ok) {
        blockers.push({ code: 'provider_unreachable', message: `OpenAI-compatible provider returned HTTP ${response.status}.` });
        return finish(false, { status: 'fail', latencyMs: Date.now() - started }, { status: 'error', modelCount: 0 });
      }
      const payload: any = await response.json().catch(() => ({}));
      const count = Array.isArray(payload?.data) ? payload.data.length : 0;
      if (!count) blockers.push({ code: 'catalog_unavailable', message: 'Provider responded but returned no models.' });
      return finish(options.workspaceOpen && count > 0, { status: 'pass', latencyMs: Date.now() - started }, { status: count ? 'live' : 'error', modelCount: count });
    } catch {
      blockers.push({ code: 'provider_unreachable', message: 'OpenAI-compatible provider could not be reached.' });
      return finish(false, { status: 'fail', latencyMs: Date.now() - started }, { status: 'error', modelCount: 0 });
    }

    function finish(ready: boolean, authentication: ProviderReadiness['authentication'], catalog: ProviderReadiness['catalog']): ProviderReadiness {
      return { provider: 'openai-compatible', ready, workspaceOpen: options.workspaceOpen, credential: { required: false, configured: true, source: 'not-required', valid: null }, authentication, catalog, blockers, checkedAt };
    }
  }

  const key = String(options.apiKey || '').trim();
  const source = options.credentialSource || 'none';
  if (!key) blockers.push({ code: 'credential_missing', message: 'Add an OpenRouter API key to continue.' });
  const started = Date.now();
  let authentication: ProviderReadiness['authentication'] = { status: key ? 'fail' : 'skipped', latencyMs: 0 };
  let valid = false;
  if (key) {
    try {
      const response = await fetchWithTimeout(fetchImpl, 'https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }, timeoutMs);
      authentication = { status: response.ok ? 'pass' : 'fail', latencyMs: Date.now() - started };
      valid = response.ok;
      if (!response.ok) blockers.push({ code: 'credential_invalid', message: `OpenRouter rejected the credential (HTTP ${response.status}).` });
    } catch {
      authentication = { status: 'fail', latencyMs: Date.now() - started };
      blockers.push({ code: 'provider_unreachable', message: 'OpenRouter authentication could not be reached.' });
    }
  }

  let catalog: ProviderReadiness['catalog'] = { status: 'error', modelCount: 0 };
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key && valid) headers.Authorization = `Bearer ${key}`;
    const response = await fetchWithTimeout(fetchImpl, 'https://openrouter.ai/api/v1/models', { headers }, timeoutMs);
    if (response.ok) {
      const payload: any = await response.json().catch(() => ({}));
      const count = Array.isArray(payload?.data) ? payload.data.length : 0;
      catalog = { status: count ? 'live' : 'error', modelCount: count };
    }
  } catch {
    catalog = { status: 'error', modelCount: 0 };
  }
  if (catalog.status !== 'live') blockers.push({ code: 'catalog_unavailable', message: 'OpenRouter model catalog is unavailable; fallback models remain visible.' });
  return {
    provider: 'openrouter',
    ready: options.workspaceOpen && valid && catalog.status === 'live',
    workspaceOpen: options.workspaceOpen,
    credential: { required: true, configured: Boolean(key), source: key ? source : 'none', valid: key ? valid : null },
    authentication,
    catalog: catalog.status === 'live' ? catalog : { status: 'fallback', modelCount: 3 },
    blockers: deduplicateBlockers(blockers),
    checkedAt
  };
}

export async function migrateLegacyCredential(
  legacyValue: string,
  existingSecret: string | undefined,
  storeSecret: (value: string) => Promise<void>,
  clearLegacy: () => Promise<void>
): Promise<{ configured: boolean; migrated: boolean }> {
  const legacy = String(legacyValue || '').trim();
  const existing = String(existingSecret || '').trim();
  let migrated = false;
  if (!existing && legacy) {
    await storeSecret(legacy);
    migrated = true;
  }
  if (legacy) await clearLegacy();
  return { configured: Boolean(existing || legacy), migrated };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function deduplicateBlockers(blockers: ProviderReadiness['blockers']): ProviderReadiness['blockers'] {
  const seen = new Set<ReadinessBlockerCode>();
  return blockers.filter(blocker => !seen.has(blocker.code) && Boolean(seen.add(blocker.code)));
}
