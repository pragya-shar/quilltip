import { describe, expect, it } from 'vitest'
import {
  chunkLoading,
  defaultLoadingProblems,
  deferredLoadingProblems,
} from './chunk-loading'

// Shapes taken from the server HTML of a patched and an unpatched build.
const ROOTS =
  '%2F_next%2Fstatic%2Fchunks%2Fturbopack-a.js%20%2F_next%2Fstatic%2Fchunks%2Fmain-b.js'
const patched = `<head><script src="/hydrate-after-paint.js?c=${ROOTS}" nonce="n"></script>
<script type="text/plain" nonce="n" data-hydrate-after-paint="/_next/static/chunks/page-c.js"></script>
<script src="/_next/static/chunks/polyfills.js" noModule=""></script></head><body><main></main>
<script src="/hydrate-after-paint.js?c=${ROOTS}#b" nonce="n" async=""></script></body>`
const unpatched = `<head><script src="/_next/static/chunks/turbopack-a.js" async="" nonce="n"></script>
<script src="/_next/static/chunks/page-c.js" async="" nonce="n"></script></head>`

describe('chunkLoading', () => {
  it('reads the loader, the inert chunks and no eager ones on a patched page', () => {
    const loading = chunkLoading(patched)
    const roots = [
      '/_next/static/chunks/turbopack-a.js',
      '/_next/static/chunks/main-b.js',
    ]
    expect(loading.loaders).toEqual([roots])
    expect(loading.lateLoaders).toEqual([roots])
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
      '0 chunk loaders in <head> without async, expected 1',
      '2 chunk scripts load before the first paint: /_next/static/chunks/turbopack-a.js, /_next/static/chunks/page-c.js',
    ])
  })

  it('flags an empty loader, a foreign entry and an inert tag with a src', () => {
    const html = `<script src="/hydrate-after-paint.js?c=" async=""></script><script src="/hydrate-after-paint.js?c=%2Fother.js"></script><script type="text/plain" src="/_next/static/chunks/x.js" data-hydrate-after-paint="/_next/static/chunks/x.js"></script>`
    const problems = deferredLoadingProblems(chunkLoading(html))
    expect(problems).toContain(
      'a late copy of the chunk loader lists other chunks'
    )
    expect(problems).toContain('the chunk loader lists /other.js')
    expect(
      problems.some((p) => p.startsWith('an inert chunk script has a src'))
    ).toBe(true)
  })

  it('flags a loader that runs after the first paint', () => {
    // The earlier patch: only the async bootstrap tag, so a press made
    // between the first paint and its arrival was lost.
    const late = `<head></head><body><main></main><script src="/hydrate-after-paint.js?c=${ROOTS}" async=""></script></body>`
    expect(deferredLoadingProblems(chunkLoading(late))).toContain(
      '0 chunk loaders in <head> without async, expected 1'
    )
    const asyncInHead = `<head><script src="/hydrate-after-paint.js?c=${ROOTS}" async=""></script></head><body></body>`
    expect(deferredLoadingProblems(chunkLoading(asyncInHead))).toContain(
      '0 chunk loaders in <head> without async, expected 1'
    )
  })

  it('flags a late copy that lists other chunks', () => {
    const html = `<head><script src="/hydrate-after-paint.js?c=${ROOTS}"></script></head><body><script src="/hydrate-after-paint.js?c=%2F_next%2Fstatic%2Fchunks%2Fother.js#b" async=""></script></body>`
    expect(deferredLoadingProblems(chunkLoading(html))).toContain(
      'a late copy of the chunk loader lists other chunks'
    )
  })

  it("reads Vercel's immutable chunk paths", () => {
    const immutable = `<head><script src="/hydrate-after-paint.js?v=1&amp;c=%2F_next%2Fstatic%2Fimmutable%2Fchunks%2Fturbopack-a.js" nonce="n"></script>
<script type="text/plain" nonce="n" data-hydrate-after-paint="/_next/static/immutable/chunks/page-c.js"></script></head><body></body>`
    const loading = chunkLoading(immutable)
    expect(loading.loaders).toEqual([
      ['/_next/static/immutable/chunks/turbopack-a.js'],
    ])
    expect(deferredLoadingProblems(loading)).toEqual([])
    const eager = `<head><script src="/_next/static/immutable/chunks/page-c.js" async=""></script></head>`
    expect(chunkLoading(eager).eager).toEqual([
      '/_next/static/immutable/chunks/page-c.js',
    ])
  })
})
