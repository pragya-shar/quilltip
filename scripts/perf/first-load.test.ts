import { describe, expect, it } from 'vitest'
import {
  FIRST_LOAD_BUDGET_KB,
  FIRST_LOAD_ROUTES,
  analyzeDataPath,
  firstLoadModules,
  forbiddenModules,
  forbiddenText,
  largestModules,
} from './first-load'

/** Builds an analyzer data file: a 4-byte header length, then JSON. */
function analyzeData(header: object): Uint8Array {
  const json = Buffer.from(JSON.stringify(header))
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.byteLength)
  // The real file carries binary tables after the header.
  return Buffer.concat([length, json, Buffer.from([0, 1, 2, 3])])
}

const header = {
  schema_version: 1,
  sources: [
    { path: '[project]/' },
    { parent_source_index: 0, path: 'components/layout/AppNavigation.tsx' },
    {
      parent_source_index: 0,
      path: 'node_modules/.bun/@stellar+stellar-sdk@14.0.0/node_modules/@stellar/stellar-sdk/lib/index.js',
    },
    { parent_source_index: 0, path: 'components/layout/AppMobileMenu.tsx' },
    { parent_source_index: 0, path: 'lib/stellar/v2/bindings/core/client.ts' },
  ],
  output_files: [
    { filename: '[client-fs]/_next/static/chunks/boot.js' },
    { filename: '[client-fs]/_next/static/chunks/page.js' },
    { filename: '[client-fs]/_next/static/chunks/page.css' },
    { filename: '[client-fs]/_next/static/chunks/lazy.js' },
  ],
  chunk_groups: [
    { kind: 'bootstrap', output_file_indices: [0] },
    { kind: 'render_dependent', output_file_indices: [1, 2] },
    { kind: 'async', output_file_indices: [3] },
  ],
  chunk_parts: [
    { source_index: 1, output_file_index: 0, compressed_size: 2048 },
    { source_index: 2, output_file_index: 1, compressed_size: 51200 },
    { source_index: 3, output_file_index: 3 },
    { source_index: 4, output_file_index: 3 },
  ],
}

describe('firstLoadModules', () => {
  it('lists modules in bootstrap and render groups, not async ones', () => {
    const { modules, jsFiles } = firstLoadModules(analyzeData(header))
    expect(jsFiles).toBe(2)
    expect([...modules].sort()).toEqual([
      '[project]/components/layout/AppNavigation.tsx',
      '[project]/node_modules/.bun/@stellar+stellar-sdk@14.0.0/node_modules/@stellar/stellar-sdk/lib/index.js',
    ])
  })

  it('sums module sizes and names the largest for a size failure', () => {
    const { sizes } = firstLoadModules(analyzeData(header))
    expect(largestModules(sizes, 1)).toEqual([
      '  50.0 KB  node_modules/.bun/@stellar+stellar-sdk@14.0.0/node_modules/@stellar/stellar-sdk/lib/index.js',
    ])
    expect(largestModules(sizes)).toHaveLength(2)
  })

  it('refuses an analyzer format it does not know', () => {
    expect(() =>
      firstLoadModules(analyzeData({ ...header, schema_version: 2 }))
    ).toThrow(/schema_version 2/)
  })
})

describe('forbiddenModules', () => {
  it('flags wallet, SDK, binding, IndexedDB and editor modules', () => {
    const found = forbiddenModules([
      '[project]/node_modules/.bun/@stellar+stellar-sdk@14.0.0/node_modules/@stellar/stellar-sdk/lib/index.js',
      '[project]/node_modules/@creit.tech/stellar-wallets-kit/index.mjs',
      '[project]/node_modules/@walletconnect/sign-client/dist/index.js',
      '[project]/node_modules/idb-keyval/dist/index.js',
      '[project]/node_modules/@tiptap/core/dist/index.js',
      '[project]/node_modules/prosemirror-view/dist/index.js',
      '[project]/lib/stellar/v2/bindings/core/client.ts',
      '[project]/lib/stellar/v2/wallet-kit.ts',
    ])
    expect(found).toHaveLength(8)
  })

  it('allows the modules the pages need', () => {
    expect(
      forbiddenModules([
        '[project]/node_modules/next/dist/client/app-index.js',
        '[project]/node_modules/convex/dist/esm/browser/index.js',
        '[project]/lib/stellar/config.ts',
        '[project]/lib/stellar/sdk-loader.ts',
        '[project]/components/layout/AppNavigation.tsx',
        // Similar names that are not the forbidden packages.
        '[project]/node_modules/idb-wrapper-lookalike/index.js',
        '[project]/node_modules/stellar-icons/index.js',
      ])
    ).toEqual([])
  })
})

describe('forbiddenText', () => {
  it('flags IndexedDB access in built chunks', () => {
    expect(
      forbiddenText([
        { file: 'a.js', contents: 'let d=window.indexedDB.open("q")' },
        { file: 'b.js', contents: 'console.log(1)' },
      ])
    ).toEqual(['IndexedDB access: a.js'])
  })
})

describe('budgets', () => {
  it('covers every measured route', () => {
    for (const route of FIRST_LOAD_ROUTES)
      expect(FIRST_LOAD_BUDGET_KB[route]).toBeGreaterThan(0)
  })

  it('finds analyzer data under the route path', () => {
    expect(analyzeDataPath('/')).toBe(
      '.next/diagnostics/analyze/data/analyze.data'
    )
    expect(analyzeDataPath('/[username]/[slug]')).toBe(
      '.next/diagnostics/analyze/data/[username]/[slug]/analyze.data'
    )
  })
})
