import {
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HYDRATE_AFTER_PAINT_REGISTRATION,
  register,
} from '../../instrumentation'
import {
  MARKER,
  NEXT_VERSION,
  REGISTRATION,
  ROUTES,
  RUNTIMES,
  installedNext,
  patchRuntime,
  replaceFile,
} from '../../patches/next@16.4.6'

// Real excerpts of the Next.js 16.4.6 Turbopack App Router runtime:
// getRequiredScripts (rt) and React DOM's pushScriptImpl (to).
const fixture = readFileSync(
  path.join(__dirname, 'runtime-fixture.txt'),
  'utf8'
)

type Required = (
  manifest: { rootMainFiles: string[] },
  assetPrefix: string,
  crossOrigin: string | undefined,
  sri: Record<string, string> | undefined,
  query: string,
  nonce: string,
  pagePath: string
) => [() => void, { src: string; crossOrigin?: string }]
type PushScript = (chunks: string[], props: Record<string, unknown>) => null
type Store = { route: string; [key: string]: unknown }

/**
 * Evaluates the excerpt with the small helpers it closes over, and a
 * `require` that returns Next.js's request store for `store`.
 */
function load(source: string, store: Store | undefined) {
  const preinit = vi.fn()
  const fakeRequire = (id: string) => {
    if (id !== 'next/dist/server/app-render/work-async-storage.external.js')
      throw new Error(`unexpected require ${id}`)
    return { workAsyncStorage: { getStore: () => store } }
  }
  const factory = new Function(
    'ev',
    'require',
    `const re=(e)=>e,th=(t)=>'<'+t,e0=(c,k,v)=>c.push(' '+k+'="'+v+'"'),e1='>',e3=()=>{},eS=/x^/,ew='',tg=(t)=>'</'+t+'>';${source};return {rt,to}`
  )
  const { rt, to } = factory({ preinit }, fakeRequire) as {
    rt: Required
    to: PushScript
  }
  return { rt, to, preinit }
}

const manifest = {
  rootMainFiles: ['static/chunks/runtime.js', 'static/chunks/main.js'],
}
const LOADER = `/hydrate-after-paint.js?c=${encodeURIComponent('/_next/static/chunks/runtime.js /_next/static/chunks/main.js')}`

/** Renders one page: its required scripts, then one chunk script. */
function render(
  store: Store | undefined,
  sri?: Record<string, string>,
  source = patchRuntime(fixture)
) {
  const { rt, to, preinit } = load(source, store)
  const [preinitScripts, bootstrap] = rt(
    manifest,
    '',
    undefined,
    sri,
    '',
    'n0nce',
    '/page'
  )
  preinitScripts()
  const chunk: string[] = []
  to(chunk, {
    src: '/_next/static/chunks/page.js',
    async: true,
    nonce: 'n0nce',
  })
  return { bootstrap, preinit, chunk: chunk.join(''), to }
}

const registration = Symbol.for(REGISTRATION)
const globals = globalThis as Record<symbol, unknown>

// A server of this checkout: instrumentation.ts has registered the patch.
beforeEach(() => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  register()
})

afterEach(() => {
  delete globals[registration]
  vi.unstubAllEnvs()
})

describe('patchRuntime on a budgeted public route', () => {
  it('covers exactly the four budgeted routes', () => {
    expect([...ROUTES].sort()).toEqual(
      ['/', '/[username]/[slug]', '/articles', '/login'].sort()
    )
  })

  it('lists the root chunks in the loader URL instead of preinit scripts', () => {
    const { bootstrap, preinit } = render({ route: '/[username]/[slug]' })
    // Only the loader is preinit'd, so React writes it in <head>.
    expect(preinit).toHaveBeenCalledTimes(1)
    expect(preinit).toHaveBeenCalledWith(LOADER, {
      as: 'script',
      nonce: 'n0nce',
      crossOrigin: undefined,
    })
    // The required bootstrap script is a second copy under another URL, so
    // React does not merge it with the preinit'd one.
    expect(bootstrap.src).toBe(`${LOADER}&b=1`)
  })

  it('writes the loader without async, so it runs before the first paint', () => {
    const { to } = render({ route: '/articles' })
    const loader: string[] = []
    to(loader, { src: LOADER, async: true, nonce: 'n0nce' })
    const tag = loader.join('')
    expect(tag).toContain(`src="${LOADER}"`)
    expect(tag).toContain('nonce="n0nce"')
    expect(tag).not.toContain('async')
    expect(tag).not.toContain('text/plain')
  })

  it('writes chunk scripts inert and leaves other scripts alone', () => {
    const { chunk, to } = render({ route: '/login' })
    expect(chunk).toContain('type="text/plain"')
    expect(chunk).toContain(
      'data-hydrate-after-paint="/_next/static/chunks/page.js"'
    )
    expect(chunk).toContain('nonce="n0nce"')
    expect(chunk).not.toContain(' src=')
    expect(chunk).not.toContain('async')

    const other: string[] = []
    to(other, { src: '/vendor/widget.js', async: true })
    expect(other.join('')).toContain('src="/vendor/widget.js"')
  })
})

describe("patchRuntime keeps Next.js's output", () => {
  function expectDefault(result: ReturnType<typeof render>) {
    expect(result.bootstrap.src).toBe('/_next/static/chunks/runtime.js')
    expect(result.preinit).toHaveBeenCalledWith(
      '/_next/static/chunks/main.js',
      {
        as: 'script',
        nonce: 'n0nce',
        crossOrigin: undefined,
      }
    )
    expect(result.chunk).toContain('src="/_next/static/chunks/page.js"')
    expect(result.chunk).not.toContain('data-hydrate-after-paint')
  }

  it('on other routes', () => {
    expectDefault(render({ route: '/settings/profile' }))
    expectDefault(render({ route: '/[username]' }))
  })

  it('when there is no request store', () => {
    expectDefault(render(undefined))
  })

  it('in a checkout without the patch (no registration)', () => {
    // A runtime left patched in node_modules after a branch switch: the other
    // branch's server never registers, so its pages keep Next.js's scripts.
    delete globals[registration]
    expectDefault(render({ route: '/articles' }))
    const loader: string[] = []
    render({ route: '/articles' }).to(loader, { src: LOADER, async: true })
    expect(loader.join('')).toContain('async')
  })

  it('on the edge runtime, where instrumentation does not register', () => {
    delete globals[registration]
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    register()
    expectDefault(render({ route: '/' }))
  })

  it('with QUILLTIP_HYDRATE_AFTER_PAINT=false at server start', () => {
    delete globals[registration]
    vi.stubEnv(MARKER, 'false')
    register()
    expect(globals[registration]).toBeUndefined()
    expectDefault(render({ route: '/' }))
  })

  it('when subresource integrity is on', () => {
    const result = render(
      { route: '/' },
      {
        'static/chunks/runtime.js': 'sha256-a',
        'static/chunks/main.js': 'sha256-b',
      }
    )
    expect(result.bootstrap.src).toBe('/_next/static/chunks/runtime.js')
    expect(result.chunk).toContain('src="/_next/static/chunks/page.js"')
  })
})

describe('patchRuntime safety', () => {
  it('changes nothing twice and refuses a runtime it does not recognise', () => {
    const once = patchRuntime(fixture)
    expect(patchRuntime(once)).toBe(once)
    expect(() => patchRuntime('function x(){}', 'other.js')).toThrow(
      /getRequiredScripts found 0 times/
    )
  })

  it('refuses a runtime patched by the earlier, in-place version', () => {
    const earlier = `/* ${MARKER} */${fixture}`
    expect(() => patchRuntime(earlier, 'old.js')).toThrow(
      /earlier version of this patch/
    )
  })

  it('uses the registration name that instrumentation.ts sets', () => {
    expect(HYDRATE_AFTER_PAINT_REGISTRATION).toBe(REGISTRATION)
  })
})

describe('replaceFile', () => {
  it('leaves a hardlinked copy (the shared download cache) unchanged', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'next-patch-'))
    try {
      const cached = path.join(dir, 'cache-runtime.js')
      const installed = path.join(dir, 'installed-runtime.js')
      writeFileSync(cached, 'original')
      // bun's hardlink backend: node_modules and the cache share one inode.
      linkSync(cached, installed)
      replaceFile(installed, 'patched')
      expect(readFileSync(installed, 'utf8')).toBe('patched')
      expect(readFileSync(cached, 'utf8')).toBe('original')
      expect(statSync(installed).ino).not.toBe(statSync(cached).ino)
      expect(statSync(installed).mode).toBe(statSync(cached).mode)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the installed Next.js', () => {
  const { root, version } = installedNext()

  it(`is ${NEXT_VERSION}, the version the patch was written for`, () => {
    // An upgrade fails here first: see docs/performance/next-patch.md.
    expect(version).toBe(NEXT_VERSION)
  })

  it.each(RUNTIMES)('%s takes the patch exactly once', (relative) => {
    const source = readFileSync(path.join(root, relative), 'utf8')
    // `next build` may already have patched it (the edit is idempotent).
    const patched = patchRuntime(source, relative)
    expect(patched.split('/hydrate-after-paint.js?c=').length - 1).toBe(1)
    expect(patched.split('"data-hydrate-after-paint"').length - 1).toBe(1)
  })

  it('leaves the development runtimes alone', () => {
    for (const relative of RUNTIMES) {
      const dev = relative.replace('.prod.js', '.dev.js')
      expect(readFileSync(path.join(root, dev), 'utf8')).not.toContain(MARKER)
    }
  })
})
