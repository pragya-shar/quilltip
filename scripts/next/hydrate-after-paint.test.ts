import { readFileSync } from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARKER, patchRuntime } from './hydrate-after-paint'

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

/** Evaluates the excerpt with the small helpers it closes over. */
function load(source: string) {
  const preinit = vi.fn()
  const factory = new Function(
    'ev',
    `const re=(e)=>e,th=(t)=>'<'+t,e0=(c,k,v)=>c.push(' '+k+'="'+v+'"'),e1='>',e3=()=>{},eS=/x^/,ew='',tg=(t)=>'</'+t+'>';${source};return {rt,to}`
  )
  const { rt, to } = factory({ preinit }) as { rt: Required; to: PushScript }
  return { rt, to, preinit }
}

const manifest = {
  rootMainFiles: ['static/chunks/runtime.js', 'static/chunks/main.js'],
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('patchRuntime', () => {
  it('lists the root chunks in the loader URL instead of preinit scripts', () => {
    const { rt, preinit } = load(patchRuntime(fixture))
    const [preinitScripts, bootstrap] = rt(
      manifest,
      '',
      undefined,
      undefined,
      '',
      'n0nce',
      '/page'
    )
    preinitScripts()
    expect(preinit).not.toHaveBeenCalled()
    expect(bootstrap.src).toBe(
      `/hydrate-after-paint.js?c=${encodeURIComponent('/_next/static/chunks/runtime.js /_next/static/chunks/main.js')}`
    )
  })

  it('writes chunk scripts inert and leaves other scripts alone', () => {
    const { to } = load(patchRuntime(fixture))
    const chunk: string[] = []
    to(chunk, {
      src: '/_next/static/chunks/page.js',
      async: true,
      nonce: 'n0nce',
    })
    const html = chunk.join('')
    expect(html).toContain('type="text/plain"')
    expect(html).toContain(
      'data-hydrate-after-paint="/_next/static/chunks/page.js"'
    )
    expect(html).toContain('nonce="n0nce"')
    expect(html).not.toContain(' src=')
    expect(html).not.toContain('async')

    const other: string[] = []
    to(other, { src: '/vendor/widget.js', async: true })
    expect(other.join('')).toContain('src="/vendor/widget.js"')
  })

  it('restores the default with QUILLTIP_HYDRATE_AFTER_PAINT=false', () => {
    vi.stubEnv(MARKER, 'false')
    const { rt, to, preinit } = load(patchRuntime(fixture))
    const [preinitScripts, bootstrap] = rt(
      manifest,
      '',
      undefined,
      undefined,
      '',
      'n0nce',
      '/page'
    )
    preinitScripts()
    expect(bootstrap.src).toBe('/_next/static/chunks/runtime.js')
    expect(preinit).toHaveBeenCalledWith('/_next/static/chunks/main.js', {
      as: 'script',
      nonce: 'n0nce',
      crossOrigin: undefined,
    })
    const chunk: string[] = []
    to(chunk, { src: '/_next/static/chunks/page.js', async: true })
    expect(chunk.join('')).toContain('src="/_next/static/chunks/page.js"')
  })

  it('keeps the default when subresource integrity is on', () => {
    const { rt } = load(patchRuntime(fixture))
    const [, bootstrap] = rt(
      manifest,
      '',
      undefined,
      {
        'static/chunks/runtime.js': 'sha256-a',
        'static/chunks/main.js': 'sha256-b',
      },
      '',
      'n0nce',
      '/page'
    )
    expect(bootstrap.src).toBe('/_next/static/chunks/runtime.js')
  })

  it('changes nothing twice and refuses a runtime it does not recognise', () => {
    const once = patchRuntime(fixture)
    expect(patchRuntime(once)).toBe(once)
    expect(() => patchRuntime('function x(){}', 'other.js')).toThrow(
      /getRequiredScripts found 0 times/
    )
  })
})
