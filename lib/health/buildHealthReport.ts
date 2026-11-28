export type BackendStatus = 'ok' | 'unreachable' | 'unconfigured'

export type HealthReport = {
  status: 'ok' | 'degraded'
  commit: string
  environment: string
  network: string
  backend: BackendStatus
  /**
   * Tab tips can be offered (Stellar testnet). False while payments v2 keys
   * or settlement are not ready, including when tab tips are not set up at
   * all; null when unknown. It does not change `status`.
   */
  tabReady: boolean | null
  checkedAt: string
}

type EnvLike = Record<string, string | undefined>

/** Build commit from Vercel or CI metadata; `unknown` for local builds. */
export function resolveBuildCommit(env: EnvLike): string {
  const commit =
    env.VERCEL_GIT_COMMIT_SHA ||
    env.NEXT_PUBLIC_BUILD_COMMIT ||
    env.GITHUB_SHA ||
    ''
  return commit.trim() || 'unknown'
}

export function resolveDeploymentEnvironment(env: EnvLike): string {
  return env.VERCEL_ENV || env.NODE_ENV || 'unknown'
}

/**
 * Check that the Convex backend answers. Convex serves `/version` without
 * auth; any non-2xx answer, network error, or timeout counts as unreachable.
 */
export async function checkBackend(
  convexUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000
): Promise<BackendStatus> {
  if (!convexUrl) return 'unconfigured'
  try {
    const response = await fetchImpl(new URL('/version', convexUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * `tabReady` from the public `chain/config:getChainConfig` query: whether
 * tab tips can be offered (keys, settlement and the Tab's state). Null when
 * the backend does not answer or has no such field. Never a reason or a key.
 */
export async function checkTabReady(
  convexUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2_000
): Promise<boolean | null> {
  if (!convexUrl) return null
  try {
    const response = await fetchImpl(new URL('/api/query', convexUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'chain/config:getChainConfig',
        args: {},
        format: 'json',
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      status?: string
      value?: { tabReady?: unknown }
    }
    return body.status === 'success' &&
      typeof body.value?.tabReady === 'boolean'
      ? body.value.tabReady
      : null
  } catch {
    return null
  }
}

export function buildHealthReport(input: {
  env: EnvLike
  network: string
  backend: BackendStatus
  /** `checkTabReady`; does not change `status`. */
  tabReady?: boolean | null
  now?: Date
}): HealthReport {
  return {
    status: input.backend === 'ok' ? 'ok' : 'degraded',
    commit: resolveBuildCommit(input.env),
    environment: resolveDeploymentEnvironment(input.env),
    network: input.network,
    backend: input.backend,
    tabReady: input.tabReady ?? null,
    checkedAt: (input.now ?? new Date()).toISOString(),
  }
}
