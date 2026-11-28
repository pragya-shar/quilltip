import {
  escapeHtml,
  sameSiteRetryHref,
  type OutageBody,
} from '@/lib/outage/outageHtml'
import {
  UNAVAILABLE_DETAIL,
  UNAVAILABLE_RETRY,
  UNAVAILABLE_WHAT,
  unavailableHeading,
} from '@/lib/outage/unavailableCopy'

/**
 * Colours and type of the legacy pages' unavailable state, as literals: the
 * outage document loads no stylesheet. scripts/perf/outage-body.test.ts
 * holds them equal to the tokens in app/shared-ui.css (`:root` and `.dark`).
 * Without scripts the theme class is never set, so dark follows the system
 * setting.
 */
export const LEGACY_OUTAGE_TOKENS = {
  light: {
    surface: '#faf5ec',
    foreground: '#390c18',
    primary: '#790333',
    mutedForeground: '#5e535a',
    border: '#cdb9b4',
  },
  dark: {
    surface: '#281b21',
    foreground: '#faf0e5',
    primary: '#edb8cd',
    mutedForeground: '#d0bbbf',
    border: '#725660',
  },
} as const

function style(): string {
  const { light, dark } = LEGACY_OUTAGE_TOKENS
  const colours = (t: typeof light | typeof dark) =>
    `--surface:${t.surface};--foreground:${t.foreground};--primary:${t.primary};--muted:${t.mutedForeground};--border:${t.border}`
  return [
    `:root{${colours(light)};color-scheme:light dark}`,
    `@media (prefers-color-scheme: dark){:root{${colours(dark)}}}`,
    'body{margin:0;background:var(--surface);color:var(--foreground);font:1rem/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}',
    'header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1.5rem;border-bottom:1px solid var(--border)}',
    'a{color:var(--primary)}',
    '.wordmark{font-weight:600;font-size:1.25rem;text-decoration:none;color:var(--foreground)}',
    'nav a{display:inline-block;padding:0.75rem 0.25rem}',
    'main{max-width:36rem;margin:0 auto;padding:4rem 1.5rem}',
    'h1{font-size:1.5rem;line-height:1.3;margin:0;text-wrap:balance}',
    '.detail{margin:1rem 0 0;color:var(--muted)}',
    '.retry{margin:1.5rem 0 0}',
    '.retry a{display:inline-block;padding:0.75rem 0;text-decoration:underline;text-underline-offset:4px}',
  ].join('')
}

/**
 * The legacy pages' outage document (#609): the site header with its way
 * home, one `h1` with the same words as the in-page `ReadingUnavailable`,
 * and a plain "Try again" link to the same URL. No scripts. Nothing from the
 * request appears but the escaped same-site path and query of that link.
 */
export const legacyOutageBody: OutageBody = (kind, url, nonce) => {
  const heading = unavailableHeading(UNAVAILABLE_WHAT[kind])
  const retry = escapeHtml(sameSiteRetryHref(url))
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(heading)} · Quilltip</title>`,
    `<style nonce="${escapeHtml(nonce)}">${style()}</style>`,
    '</head>',
    '<body>',
    '<header>',
    '<a class="wordmark" href="/" aria-label="Quilltip home">Quilltip</a>',
    '<nav aria-label="Main navigation"><a href="/articles">Articles</a></nav>',
    '</header>',
    '<main>',
    `<h1>${escapeHtml(heading)}</h1>`,
    `<p class="detail">${escapeHtml(UNAVAILABLE_DETAIL)}</p>`,
    `<p class="retry"><a href="${retry}">${escapeHtml(UNAVAILABLE_RETRY)}</a></p>`,
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}
