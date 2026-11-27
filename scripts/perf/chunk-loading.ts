// How a page's server HTML loads its Next.js chunk scripts, for the checks on
// patches/next@16.4.6.ts (perf:budget, the first-load check and their tests).

export const LOADER_PATH = '/hydrate-after-paint.js'
/** Chunk script paths: Next.js's, and Vercel's immutable assets. */
export const CHUNK_PREFIXES = [
  '/_next/static/chunks/',
  '/_next/static/immutable/chunks/',
]
const isChunk = (pathname: string) =>
  CHUNK_PREFIXES.some((prefix) => pathname.startsWith(prefix))

export type ChunkLoading = {
  /**
   * Root chunks listed in the URL of each loader tag that runs before the
   * first paint: in <head>, without `async`.
   */
  loaders: string[][]
  /**
   * The same for every other loader tag: the async bootstrap copy (`#b`),
   * or a loader that would run after the first paint.
   */
  lateLoaders: string[][]
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
    lateLoaders: [],
    inert: [],
    eager: [],
    inertWithSrc: [],
  }
  const bodyAt = html.indexOf('<body')
  for (const match of html.matchAll(/<script\b[^>]*>/g)) {
    const tag = match[0]
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
      const chunks = (url.searchParams.get('c') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((chunk) => new URL(chunk, base).pathname)
      const inHead = bodyAt === -1 || match.index! < bodyAt
      const blocking = !/\s(async|defer)(=|\s|>|\/)/i.test(tag)
      if (inHead && blocking) result.loaders.push(chunks)
      else result.lateLoaders.push(chunks)
    } else if (isChunk(url.pathname) && !/\snoModule(=|\s|>)/i.test(tag)) {
      result.eager.push(url.pathname)
    }
  }
  return result
}

/**
 * Problems with a page that should start its chunk scripts after the first
 * paint: exactly one loader that runs before the first paint (in <head>,
 * without async, so a press right after the paint is held), at most one late
 * bootstrap copy with the same chunks, and no chunk script that the browser
 * would fetch or run before the loader.
 */
export function deferredLoadingProblems(loading: ChunkLoading): string[] {
  const problems: string[] = []
  if (loading.loaders.length !== 1)
    problems.push(
      `${loading.loaders.length} chunk loaders in <head> without async, expected 1`
    )
  if (loading.lateLoaders.length > 1)
    problems.push(
      `${loading.lateLoaders.length} late copies of the chunk loader, expected at most 1`
    )
  for (const late of loading.lateLoaders)
    if (late.join(' ') !== (loading.loaders[0] ?? []).join(' '))
      problems.push('a late copy of the chunk loader lists other chunks')
  const roots = loading.loaders.flat()
  if (loading.loaders.length === 1 && roots.length === 0)
    problems.push('the chunk loader lists no root chunks')
  for (const chunk of roots)
    if (!isChunk(chunk)) problems.push(`the chunk loader lists ${chunk}`)
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
  if (loading.loaders.length + loading.lateLoaders.length > 0)
    problems.push('a chunk loader is present')
  if (loading.inert.length > 0)
    problems.push(`${loading.inert.length} chunk scripts are inert`)
  if (loading.eager.length === 0) problems.push('no chunk scripts')
  return problems
}
