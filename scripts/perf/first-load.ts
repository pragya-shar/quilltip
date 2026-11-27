// First-load JavaScript of the measured routes: what the browser must fetch
// before a page can hydrate. Used by scripts/perf/first-load-budget.ts.
//
// Two build outputs are read:
// - `.next/diagnostics/route-bundle-stats.json`, written by `next build`:
//   the first-load chunk files of each route. Their gzip size is the budget.
// - `.next/diagnostics/analyze/data/<route>/analyze.data`, written by
//   `next experimental-analyze --output`: which source modules each chunk
//   holds. Used to refuse modules that must load only on demand.
import { gzipSync } from 'zlib'
import { SURFACE_FIRST_LOAD } from './routes'

/** The routes whose first load is budgeted, as Next.js names them. */
export const FIRST_LOAD_ROUTES = [
  '/',
  '/login',
  '/articles',
  // The rebuilt routes, one file per package (scripts/perf/routes).
  ...SURFACE_FIRST_LOAD.map((entry) => entry.route),
] as const
export type FirstLoadRoute = (typeof FIRST_LOAD_ROUTES)[number]

/**
 * Gzip budget for each route's first-load JavaScript, in KB (1024 bytes).
 * Each is the measured size plus about 2 KB, so removing a lazy boundary or a
 * few KB of growth fails; raise a budget in the change that needs it. See
 * docs/performance/page-load.md.
 */
export const FIRST_LOAD_BUDGET_KB: Record<FirstLoadRoute, number> = {
  '/': 211, // measured 208.9
  '/login': 202, // measured 199.4
  '/articles': 216, // measured 214.0
  ...Object.fromEntries(
    SURFACE_FIRST_LOAD.map((entry) => [entry.route, entry.budgetKb])
  ),
}

/**
 * Modules that must never be in the first load of these routes. Wallet, SDK
 * and contract code loads when a reader starts a payment flow, and the editor
 * loads after the article has rendered. Each entry matches the module's full
 * source path as the analyzer reports it.
 */
export const FORBIDDEN_FIRST_LOAD_MODULES: {
  label: string
  pattern: RegExp
}[] = [
  { label: 'Stellar SDK (@stellar/*)', pattern: pkg('@stellar/[^/]+') },
  {
    label: 'Stellar Wallets Kit (@creit.tech/*)',
    pattern: pkg('@creit\\.tech/[^/]+'),
  },
  {
    label: 'wallet connectors',
    pattern: pkg(
      '(?:@walletconnect|@reown|@ledgerhq|@trezor|@albedo-link|@hot-wallet|@lobstrco|@ngneat)/[^/]+'
    ),
  },
  {
    label: 'IndexedDB libraries',
    pattern: pkg('(?:idb|idb-keyval|dexie)'),
  },
  {
    label: 'Arweave upload code',
    pattern: pkg('(?:@ardrive/[^/]+|arweave)'),
  },
  {
    label: 'editor (Tiptap, ProseMirror)',
    pattern: pkg('(?:@tiptap/[^/]+|prosemirror-[^/]+)'),
  },
  {
    // The balance's content loads when its sheet or panel opens
    // (shell/pocket/loadPocket.ts), never with a page.
    label: 'the balance sheet (components/pocket)',
    pattern: /\[project\]\/components\/pocket\//,
  },
  {
    label: 'v2 payment code (lib/stellar/v2: bindings, wallet kit)',
    pattern: /\[project\]\/lib\/stellar\/v2\//,
  },
]

/** Text that marks IndexedDB use in built code; a global name survives minification. */
export const FORBIDDEN_FIRST_LOAD_TEXT: { label: string; text: string }[] = [
  { label: 'IndexedDB access', text: 'indexedDB' },
]

function pkg(name: string): RegExp {
  // Bun installs packages under node_modules/.bun/<id>/node_modules/<name>.
  return new RegExp(`node_modules/(?:\\.bun/[^/]+/node_modules/)?${name}/`)
}

export type RouteBundleStats = {
  route: string
  firstLoadUncompressedJsBytes: number
  firstLoadChunkPaths: string[]
}[]

/** Gzip size in bytes, at the level `next start` and most CDNs serve. */
export function gzipBytes(contents: Uint8Array): number {
  return gzipSync(contents, { level: 6 }).byteLength
}

type AnalyzeHeader = {
  schema_version: number
  sources: { parent_source_index?: number | null; path: string }[]
  chunk_parts: {
    source_index: number
    output_file_index: number
    compressed_size?: number
  }[]
  output_files: { filename: string }[]
  chunk_groups: { kind: string; output_file_indices: number[] }[]
}

/**
 * The source modules in a route's first load, from the analyzer's data file.
 * The first load is the bootstrap chunk group plus every group the page needs
 * to render; `async` groups are loaded on demand and are left out.
 */
export function firstLoadModules(analyzeData: Uint8Array): {
  modules: Set<string>
  /** Compressed bytes per module, as the analyzer reports them. */
  sizes: Map<string, number>
  jsFiles: number
} {
  const view = Buffer.from(analyzeData)
  const headerLength = view.readUInt32BE(0)
  const header = JSON.parse(
    view.subarray(4, 4 + headerLength).toString('utf8')
  ) as AnalyzeHeader
  if (header.schema_version !== 1) {
    throw new Error(
      `Unknown analyzer schema_version ${header.schema_version}; update scripts/perf/first-load.ts for this Next.js version`
    )
  }
  const files = new Set<number>()
  for (const group of header.chunk_groups) {
    if (group.kind === 'async') continue
    for (const index of group.output_file_indices) {
      if (header.output_files[index]?.filename.endsWith('.js')) files.add(index)
    }
  }
  const paths = new Map<number, string>()
  const sourcePath = (index: number): string => {
    const cached = paths.get(index)
    if (cached !== undefined) return cached
    const source = header.sources[index]
    if (!source) return ''
    const parent =
      source.parent_source_index == null
        ? ''
        : sourcePath(source.parent_source_index)
    const full = parent + source.path
    paths.set(index, full)
    return full
  }
  const modules = new Set<string>()
  const sizes = new Map<string, number>()
  for (const part of header.chunk_parts) {
    if (!files.has(part.output_file_index)) continue
    const modulePath = sourcePath(part.source_index)
    modules.add(modulePath)
    sizes.set(
      modulePath,
      (sizes.get(modulePath) ?? 0) + (part.compressed_size ?? 0)
    )
  }
  return { modules, sizes, jsFiles: files.size }
}

/** The largest modules, as "KB  path" lines, to name the cause of a size failure. */
export function largestModules(
  sizes: Map<string, number>,
  count = 10
): string[] {
  return [...sizes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(
      ([modulePath, bytes]) =>
        `${(bytes / 1024).toFixed(1).padStart(6)} KB  ${modulePath.replace('[project]/', '')}`
    )
}

/** Forbidden modules found, as "label: module path" lines. */
export function forbiddenModules(modules: Iterable<string>): string[] {
  const found: string[] = []
  for (const modulePath of modules) {
    for (const { label, pattern } of FORBIDDEN_FIRST_LOAD_MODULES) {
      if (pattern.test(modulePath)) found.push(`${label}: ${modulePath}`)
    }
  }
  return found.sort()
}

/** Forbidden text found in built chunk contents, as "label: file" lines. */
export function forbiddenText(
  chunks: { file: string; contents: string }[]
): string[] {
  const found: string[] = []
  for (const { file, contents } of chunks) {
    for (const { label, text } of FORBIDDEN_FIRST_LOAD_TEXT) {
      if (contents.includes(text)) found.push(`${label}: ${file}`)
    }
  }
  return found
}

/** The analyzer's data directory for a route (`/` is the root). */
export function analyzeDataPath(route: FirstLoadRoute): string {
  return `.next/diagnostics/analyze/data${route === '/' ? '' : route}/analyze.data`
}
