import { readFileSync } from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MARKER,
  NEXT_VERSION,
  ROUTES,
  RUNTIMES,
  installedNext,
  patchRuntime,
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

afterEach(() => {
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
    expect(preinit).not.toHaveBeenCalled()
    expect(bootstrap.src).toBe(LOADER)
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

  it('with QUILLTIP_HYDRATE_AFTER_PAINT=false', () => {
    vi.stubEnv(MARKER, 'false')
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
