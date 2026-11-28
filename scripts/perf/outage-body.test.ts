import { readFileSync } from 'fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadingUnavailable } from '../../components/articles/ReadingUnavailable'
import {
  LEGACY_OUTAGE_TOKENS,
  legacyOutageBody,
} from '../../lib/outage/legacyOutageBody'
import {
  outageBodyFor,
  outageContentSecurityPolicy,
  outagePathKind,
  type OutagePathKind,
} from '../../lib/outage/outageBody'
import { sameSiteRetryHref } from '../../lib/outage/outageHtml'
import { UNAVAILABLE_WHAT } from '../../lib/outage/unavailableCopy'

/**
 * The outage document of the legacy pages (#609): structure, the same words
 * and links as the in-page fallback, a "Try again" link that stays on this
 * site, and colours equal to the design tokens.
 */

const KINDS: OutagePathKind[] = ['articles', 'writer', 'article']
const NONCE = 'bm9uY2UtZm9yLXRlc3Rz'
const page = (kind: OutagePathKind, href = 'https://quilltip.test/articles') =>
  legacyOutageBody(kind, new URL(href), NONCE)

const all = (html: string, pattern: RegExp) => [...html.matchAll(pattern)]
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .trim()
const headingOf = (html: string) =>
  text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '')
const paragraphs = (html: string) =>
  all(html, /<p[^>]*>([\s\S]*?)<\/p>/g).map((m) => text(m[1]!))
const links = (html: string) =>
  all(html, /<a\b([^>]*)>([\s\S]*?)<\/a>/g).map((m) => ({
    href: m[1]!.match(/href="([^"]*)"/)?.[1],
    label: m[1]!.match(/aria-label="([^"]*)"/)?.[1] ?? text(m[2]!),
  }))

describe('the legacy outage document', () => {
  it.each(KINDS)('%s: one h1, landmarks, a title, no script', (kind) => {
    const html = page(kind)
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true)
    expect(all(html, /<h1\b/g)).toHaveLength(1)
    expect(all(html, /<header\b/g)).toHaveLength(1)
    expect(all(html, /<main\b/g)).toHaveLength(1)
    expect(html).toMatch(/<title>[^<]+ · Quilltip<\/title>/)
    expect(html).not.toMatch(/<script\b/i)
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<style nonce="${NONCE}">`)
  })

  it.each(KINDS)(
    '%s: the same words and links as ReadingUnavailable',
    (kind) => {
      const retryHref = '/fixture-writer/the-lamp?tab=articles'
      const outage = page(kind, `https://quilltip.test${retryHref}`)
      const inPage = renderToStaticMarkup(
        createElement(ReadingUnavailable, {
          what: UNAVAILABLE_WHAT[kind],
          retryHref,
          headingLevel: 1,
        })
      )
      expect(headingOf(outage)).toBe(headingOf(inPage))
      expect(paragraphs(outage)).toEqual(paragraphs(inPage))
      const retry = (html: string) =>
        links(html).find((link) => link.label === 'Try again')
      expect(retry(outage)).toEqual(retry(inPage))
      // The way home is the header's wordmark, as on the legacy pages
      // (READING.wayHome in scripts/perf/no-script-reading.ts).
      expect(links(outage)).toContainEqual({
        href: '/',
        label: 'Quilltip home',
      })
      expect(links(outage)).toContainEqual({
        href: '/articles',
        label: 'Articles',
      })
    }
  )

  it('says only what is true: no figures and nothing from the request but the link', () => {
    const html = page('article', 'https://quilltip.test/a/b?q=secret-value')
    const visible = text(html.slice(html.indexOf('<body>')))
    expect(visible).not.toMatch(/\d/)
    expect(all(html, /secret-value/g)).toHaveLength(1)
    expect(links(html).find((l) => l.label === 'Try again')?.href).toBe(
      '/a/b?q=secret-value'
    )
  })
})

describe('the "Try again" link stays on this site', () => {
  const base = 'https://quilltip.test'
  it.each([
    ['//evil.example/x', '/evil.example/x'],
    ['/\\evil.example', '/evil.example'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
    ['/javascript:alert(1)', '/javascript:alert(1)'],
    ['/%6Aavascript%3Aalert(1)', '/%6Aavascript%3Aalert(1)'],
  ])('%s', (path, expected) => {
    const href = sameSiteRetryHref(new URL(base + path))
    expect(href).toBe(expected)
    expect(new URL(href, base).origin).toBe(base)
  })

  it('escapes markup in the query', () => {
    const html = page(
      'articles',
      `${base}/articles?q="><script>alert(1)</script>&x='y'`
    )
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toContain('"><script')
    expect(html).not.toContain("'y'")
    const href = links(html).find((l) => l.label === 'Try again')!.href!
    expect(new URL(href.replaceAll('&amp;', '&'), base).origin).toBe(base)
  })
})

describe('outage paths and policy', () => {
  it.each([
    ['/', null],
    ['/login', null],
    ['/articles', 'articles'],
    ['/fixture-writer', 'writer'],
    ['/fixture-writer/the-lamp', 'article'],
    ['/@fixture-writer', null],
    ['/robots.txt', null],
  ])('%s is %s', (path, kind) => {
    expect(outagePathKind(path)).toBe(kind)
    expect(outageBodyFor(path)?.kind ?? null).toBe(kind)
  })

  it('allows only the nonce’d style', () => {
    const policy = outageContentSecurityPolicy(NONCE)
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain(`style-src 'nonce-${NONCE}'`)
    expect(policy).not.toContain('unsafe-inline')
    expect(policy).not.toContain('script-src')
  })
})

describe('the colours equal the design tokens', () => {
  const css = readFileSync('app/shared-ui.css', 'utf8')
  const block = (selectorStart: RegExp) => {
    const start = css.search(selectorStart)
    expect(start).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start))
  }
  const token = (body: string, name: string) =>
    body.match(new RegExp(`--ui-${name}:\\s*([^;]+);`))?.[1]?.trim()
  const names = {
    surface: 'surface',
    foreground: 'foreground',
    primary: 'primary',
    mutedForeground: 'muted-foreground',
    border: 'border',
  } as const

  it.each([
    ['light', /^:root,\s*\n\.ui-light/m],
    ['dark', /^\.dark \{/m],
  ] as const)('%s', (theme, selector) => {
    const body = block(selector)
    for (const [key, name] of Object.entries(names))
      expect(
        LEGACY_OUTAGE_TOKENS[theme][key as keyof typeof names],
        `--ui-${name}`
      ).toBe(token(body, name))
  })
})
