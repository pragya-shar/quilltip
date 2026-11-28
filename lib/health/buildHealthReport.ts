export type BackendStatus = 'ok' | 'unreachable' | 'unconfigured'

export type HealthReport = {
  status: 'ok' | 'degraded'
  commit: string
  environment: string
  network: string
  backend: BackendStatus
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

export function buildHealthReport(input: {
  env: EnvLike
  network: string
  backend: BackendStatus
  now?: Date
}): HealthReport {
  return {
    status: input.backend === 'ok' ? 'ok' : 'degraded',
    commit: resolveBuildCommit(input.env),
    environment: resolveDeploymentEnvironment(input.env),
    network: input.network,
    backend: input.backend,
    checkedAt: (input.now ?? new Date()).toISOString(),
  }
}
