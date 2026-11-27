import { describe, expect, it } from 'vitest'
import {
  chunkLoading,
  defaultLoadingProblems,
  deferredLoadingProblems,
} from './chunk-loading'

// Shapes taken from the server HTML of a patched and an unpatched build.
const patched = `<head><script src="/hydrate-after-paint.js?c=%2F_next%2Fstatic%2Fchunks%2Fturbopack-a.js%20%2F_next%2Fstatic%2Fchunks%2Fmain-b.js" async="" nonce="n"></script>
<script type="text/plain" nonce="n" data-hydrate-after-paint="/_next/static/chunks/page-c.js"></script>
<script src="/_next/static/chunks/polyfills.js" noModule=""></script></head>`
const unpatched = `<head><script src="/_next/static/chunks/turbopack-a.js" async="" nonce="n"></script>
<script src="/_next/static/chunks/page-c.js" async="" nonce="n"></script></head>`

describe('chunkLoading', () => {
  it('reads the loader, the inert chunks and no eager ones on a patched page', () => {
    const loading = chunkLoading(patched)
    expect(loading.loaders).toEqual([
      ['/_next/static/chunks/turbopack-a.js', '/_next/static/chunks/main-b.js'],
    ])
    expect(loading.inert).toEqual(['/_next/static/chunks/page-c.js'])
    expect(loading.eager).toEqual([])
    expect(deferredLoadingProblems(loading)).toEqual([])
    expect(defaultLoadingProblems(loading)).toEqual([
      'a chunk loader is present',
      '1 chunk scripts are inert',
      'no chunk scripts',
    ])
  })

  it("reads Next.js's own output on an unpatched page", () => {
    const loading = chunkLoading(unpatched)
    expect(loading.loaders).toEqual([])
    expect(loading.eager).toHaveLength(2)
    expect(defaultLoadingProblems(loading)).toEqual([])
    expect(deferredLoadingProblems(loading)).toEqual([
      '0 chunk loaders, expected 1',
      '2 chunk scripts load before the first paint: /_next/static/chunks/turbopack-a.js, /_next/static/chunks/page-c.js',
    ])
  })

  it('flags an empty loader, a foreign entry and an inert tag with a src', () => {
    const html = `<script src="/hydrate-after-paint.js?c=" async=""></script><script src="/hydrate-after-paint.js?c=%2Fother.js"></script><script type="text/plain" src="/_next/static/chunks/x.js" data-hydrate-after-paint="/_next/static/chunks/x.js"></script>`
    const problems = deferredLoadingProblems(chunkLoading(html))
    expect(problems).toContain('2 chunk loaders, expected 1')
    expect(problems).toContain('the chunk loader lists /other.js')
    expect(
      problems.some((p) => p.startsWith('an inert chunk script has a src'))
    ).toBe(true)
  })
})
