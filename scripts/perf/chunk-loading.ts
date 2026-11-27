// How a page's server HTML loads its Next.js chunk scripts, for the checks on
// patches/next@16.4.6.ts (perf:budget, the first-load check and their tests).

export const LOADER_PATH = '/hydrate-after-paint.js'
const CHUNK_PREFIX = '/_next/static/chunks/'

export type ChunkLoading = {
  /** Root chunks listed in the loader's URL, one list per loader tag. */
  loaders: string[][]
  /** Chunk scripts written inert, started by the loader. */
  inert: string[]
  /** Chunk scripts the browser runs as soon as they arrive. */
  eager: string[]
  /** Inert tags that still carry a `src` (the browser would fetch them). */
  inertWithSrc: string[]
}

function attribute(tag: string, name: string): string | undefined {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
  return value?.replace(/&amp;/g, '&')
}

/** Reads the script tags of one page's server HTML. */
export function chunkLoading(html: string, base = 'http://localhost') {
  const result: ChunkLoading = {
    loaders: [],
    inert: [],
    eager: [],
    inertWithSrc: [],
  }
  for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
    const src = attribute(tag, 'src')
    const deferred = attribute(tag, 'data-hydrate-after-paint')
    if (deferred !== undefined) {
      result.inert.push(new URL(deferred, base).pathname)
      if (src !== undefined) result.inertWithSrc.push(tag)
      continue
    }
    if (!src) continue
    const url = new URL(src, base)
    if (url.pathname === LOADER_PATH) {
      result.loaders.push(
        (url.searchParams.get('c') ?? '')
          .split(' ')
          .filter(Boolean)
          .map((chunk) => new URL(chunk, base).pathname)
      )
    } else if (
      url.pathname.startsWith(CHUNK_PREFIX) &&
      !/\snoModule(=|\s|>)/i.test(tag)
    ) {
      result.eager.push(url.pathname)
    }
  }
  return result
}

/**
 * Problems with a page that should start its chunk scripts after the first
 * paint: exactly one loader with root chunks, and no chunk script that the
 * browser would fetch or run before it.
 */
export function deferredLoadingProblems(loading: ChunkLoading): string[] {
  const problems: string[] = []
  if (loading.loaders.length !== 1)
    problems.push(`${loading.loaders.length} chunk loaders, expected 1`)
  const roots = loading.loaders.flat()
  if (loading.loaders.length === 1 && roots.length === 0)
    problems.push('the chunk loader lists no root chunks')
  for (const chunk of roots)
    if (!chunk.startsWith(CHUNK_PREFIX))
      problems.push(`the chunk loader lists ${chunk}`)
  if (loading.eager.length > 0)
    problems.push(
      `${loading.eager.length} chunk scripts load before the first paint: ${loading.eager.slice(0, 3).join(', ')}`
    )
  for (const tag of loading.inertWithSrc)
    problems.push(`an inert chunk script has a src: ${tag}`)
  return problems
}

/** Problems with a page that should load its chunk scripts as Next.js does. */
export function defaultLoadingProblems(loading: ChunkLoading): string[] {
  const problems: string[] = []
  if (loading.loaders.length > 0) problems.push('a chunk loader is present')
  if (loading.inert.length > 0)
    problems.push(`${loading.inert.length} chunk scripts are inert`)
  if (loading.eager.length === 0) problems.push('no chunk scripts')
  return problems
}
