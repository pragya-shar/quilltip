/**
 * First path segments of the signin package's routes (`/name` and below), so
 * the proxy never reads them as a writer's handle. Owned by that package.
 */
export const segments: readonly string[] = []
