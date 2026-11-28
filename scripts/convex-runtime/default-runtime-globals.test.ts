/**
 * Bundles every Convex module that runs in the default runtime, as the Convex
 * CLI bundles it (`convex/dist/cjs/bundler`: esbuild, `platform: "browser"`,
 * conditions `convex` and `module`), and reads the bundle for Node-only
 * globals. The default runtime has none of them, so a reference that a test
 * in Node or the edge runtime gets away with throws there.
 *
 * The scan covers the dependencies too (`@stellar/stellar-sdk`, Convex Auth),
 * and every function body, not only the code that runs on import.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { basename, join, relative, resolve } from 'path'

import { build } from 'esbuild'
import { Linter, type Rule } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const CONVEX = join(ROOT, 'convex')

/** Globals that Node has and the Convex default runtime does not. */
const NODE_ONLY = new Set([
  'Buffer',
  'require',
  'module',
  'exports',
  'global',
  '__dirname',
  '__filename',
  'setImmediate',
  'clearImmediate',
])

/** Objects through which a global can also be read: `globalThis.Buffer`. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global'])

/**
 * Reviewed property reads of a Node-only global. Reading `globalThis.Buffer`
 * gives `undefined` there instead of throwing, so it is a feature check when
 * the code does not use the value on that path.
 */
const REVIEWED: { module: string; name: string; why: string }[] = [
  {
    // From `@stellar/stellar-sdk` (StrKey base32). The value is used only for
    // the 'buffer' output format; the SDK asks for the default 'uint8'.
    module: 'node_modules/@exodus/bytes/fallback/_utils.js',
    name: 'globalThis.Buffer',
    why: 'feature check; only the unused buffer output format reads it',
  },
]

const USE_NODE = /^\s*("|')use node("|');?\s*$/m

/** Entry points as `entryPointsByEnvironment` in the Convex CLI picks them. */
function defaultRuntimeEntries(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const rel = relative(CONVEX, path)
    if (statSync(path).isDirectory()) {
      if (rel === '_generated' || name.startsWith('.')) continue
      if (rel === 'node_modules') continue
      // A nested component directory is bundled on its own.
      try {
        statSync(join(path, 'convex.config.ts'))
        continue
      } catch {}
      out.push(...defaultRuntimeEntries(path))
      continue
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) continue
    if (name.startsWith('.') || name.startsWith('#')) continue
    if ((basename(name).match(/\./g) ?? []).length > 1) continue
    if (rel.includes(' ')) continue
    const source = readFileSync(path, 'utf8')
    if (/\.tsx?$/.test(name) && !/^\s{0,100}(import|export)/m.test(source))
      continue
    if (USE_NODE.test(source.split('\n').find((l) => l.trim()) ?? '')) continue
    out.push(path)
  }
  return out
}

type Finding = {
  name: string
  file: string
  module: string
  context: string
  at: number
}

/** `typeof X` anywhere in `node`. */
function mentionsTypeof(node: Rule.Node | null | undefined, name: string) {
  let found = false
  const visit = (n: unknown): void => {
    if (found || !n || typeof n !== 'object') return
    const o = n as Record<string, unknown>
    if (
      o.type === 'UnaryExpression' &&
      o.operator === 'typeof' &&
      (o.argument as { type?: string; name?: string })?.type === 'Identifier' &&
      (o.argument as { name?: string }).name === name
    ) {
      found = true
      return
    }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'parent') continue
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === 'object' && 'type' in v) visit(v)
    }
  }
  visit(node)
  return found
}

/**
 * True when the reference sits behind a `typeof name` check: the right side
 * of `typeof x !== 'undefined' && …`, or a branch of a conditional or `if`
 * whose test checks it.
 */
function guarded(node: Rule.Node, name: string) {
  let child: Rule.Node = node
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (
      p.type === 'LogicalExpression' &&
      p.right === child &&
      mentionsTypeof(p.left as Rule.Node, name)
    )
      return true
    if (
      (p.type === 'ConditionalExpression' || p.type === 'IfStatement') &&
      p.test !== child &&
      mentionsTypeof(p.test as Rule.Node, name)
    )
      return true
  }
  return false
}

function scan(file: string, text: string): Finding[] {
  const findings: Finding[] = []
  const at = (node: Rule.Node, name: string) => {
    const [start] = node.range!
    // esbuild starts each bundled module with a `// path` comment.
    const before = text.slice(0, start)
    const marks = [...before.matchAll(/^\/\/ (\S+\.[cm]?[jt]sx?)$/gm)]
    findings.push({
      name,
      file,
      module: marks.at(-1)?.[1] ?? '(entry)',
      at: start,
      context: text
        .slice(Math.max(0, start - 80), start + 60)
        .replace(/\s+/g, ' '),
    })
  }
  const rule: Rule.RuleModule = {
    create(context) {
      return {
        'Program:exit'() {
          const scope = context.sourceCode.scopeManager.globalScope!
          // Unresolved names, and names that resolve to a built-in global
          // such as `globalThis` (those have no definition).
          const refs = [
            ...scope.through,
            ...scope.variables
              .filter((v) => v.defs.length === 0)
              .flatMap((v) => v.references),
          ]
          for (const ref of refs) {
            const id = ref.identifier as Rule.Node & { name: string }
            const parent = id.parent as Rule.Node
            if (
              parent.type === 'UnaryExpression' &&
              parent.operator === 'typeof'
            )
              continue
            const member =
              parent.type === 'MemberExpression' && parent.object === id
                ? parent
                : null
            const prop =
              member &&
              !member.computed &&
              member.property.type === 'Identifier'
                ? member.property.name
                : member?.property.type === 'Literal'
                  ? String(member.property.value)
                  : null
            if (NODE_ONLY.has(id.name)) {
              if (!guarded(id, id.name)) at(id, id.name)
            } else if (id.name === 'process') {
              // `process.env` is provided; anything else must be guarded.
              if (prop !== 'env' && !guarded(id, 'process'))
                at(id, `process${prop ? '.' + prop : ''}`)
            }
            if (GLOBAL_OBJECTS.has(id.name) && prop && NODE_ONLY.has(prop)) {
              const m = member as Rule.Node
              const up = m.parent as Rule.Node
              if (
                !(up.type === 'UnaryExpression' && up.operator === 'typeof') &&
                !guarded(id, prop)
              )
                at(m, `${id.name}.${prop}`)
            }
          }
        },
      }
    },
  }
  const linter = new Linter({ configType: 'flat' })
  const messages = linter.verify(text, [
    {
      plugins: { scan: { rules: { globals: rule } } },
      rules: { 'scan/globals': 'error' },
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  ])
  const fatal = messages.find((m) => m.fatal)
  if (fatal) throw new Error(`${file}: ${fatal.message}`)
  return findings.sort((a, b) => a.at - b.at)
}

let entries: string[]
let findings: Finding[]
let outputs: number

beforeAll(async () => {
  entries = defaultRuntimeEntries(CONVEX)
  const result = await build({
    entryPoints: entries,
    absWorkingDir: ROOT,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'esnext',
    jsx: 'automatic',
    outdir: 'out',
    outbase: CONVEX,
    conditions: ['convex', 'module'],
    write: false,
    splitting: true,
    logLevel: 'silent',
    plugins: [
      {
        // As the Convex CLI does for the default runtime.
        name: 'async-hooks-shim',
        setup(b) {
          b.onResolve({ filter: /^(node:)?async_hooks$/ }, (args) => ({
            path: args.path,
            namespace: 'async-hooks-shim',
          }))
          b.onLoad({ filter: /.*/, namespace: 'async-hooks-shim' }, () => ({
            contents:
              'export const AsyncLocalStorage = globalThis.AsyncLocalStorage; export default {}',
            loader: 'js',
          }))
        },
      },
    ],
  })
  outputs = result.outputFiles.length
  findings = result.outputFiles.flatMap((f) =>
    scan(relative(ROOT, f.path), f.text)
  )
}, 120_000)

describe('Convex default runtime bundle', () => {
  it('bundles the default-runtime modules', () => {
    const rel = entries.map((e) => relative(CONVEX, e))
    expect(rel).toContain('tabs.ts')
    expect(rel).toContain('lib/chain/voucher.ts')
    expect(rel).not.toContain('tabSettler.ts')
    expect(outputs).toBeGreaterThan(entries.length - 1)
  })

  const reviewed = (f: Finding) =>
    REVIEWED.some((r) => r.module === f.module && r.name === f.name)

  it('reads no Node-only global', () => {
    expect(findings.filter((f) => !reviewed(f))).toEqual([])
  })

  it('still has each reviewed read (drop entries that no longer apply)', () => {
    for (const r of REVIEWED)
      expect(
        findings.some((f) => f.module === r.module && f.name === r.name),
        r.module
      ).toBe(true)
  })
})

describe('the scan', () => {
  const names = (src: string) => scan('fixture.js', src).map((f) => f.name)

  it('reports Node-only globals and unguarded process use', () => {
    expect(
      names(`
        export const a = () => Buffer.from('x')
        export const b = () => globalThis.Buffer
        export const c = () => require('fs')
        export const d = () => process.versions.node
        export const e = () => global.x
        export const f = () => setImmediate(() => {})
      `)
    ).toEqual([
      'Buffer',
      'globalThis.Buffer',
      'require',
      'process.versions',
      'global',
      'setImmediate',
    ])
  })

  it('allows process.env, typeof checks and guarded reads', () => {
    expect(
      names(`
        export const a = () => process.env.X
        export const b = typeof Buffer
        export const c = () => typeof process !== 'undefined' && process.versions.node
        export const d = () => (typeof Buffer === 'undefined' ? null : Buffer.from('x'))
        export const e = () => { if (typeof require === 'function') require('x') }
        export const f = typeof globalThis.Buffer
        const Buffer2 = 1; export const g = Buffer2
      `)
    ).toEqual([])
  })
})
