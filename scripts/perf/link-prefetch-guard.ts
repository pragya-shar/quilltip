// A source guard for #630: every `next/link` Link to a public article or
// writer page carries `prefetch={ARTICLE_LINK_PREFETCH}`. Each prefetch of
// such a page runs the proxy's route check and renders the page, so one
// unflagged card costs backend reads for every card in view.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

export type LinkFinding = { file: string; line: number; href: string }

/** Opening `<Link …>` tags of a source file, with their offset. */
export function linkTags(source: string): { tag: string; at: number }[] {
  const tags: { tag: string; at: number }[] = []
  const start = /<Link\b/g
  let match: RegExpExecArray | null
  while ((match = start.exec(source))) {
    // Contexts inside the tag: braces of code and template literals. A `>`
    // ends the tag only at the tag's own level, outside strings.
    const stack: ('brace' | 'template')[] = []
    let quote: '"' | "'" | null = null
    let i = match.index + match[0].length
    for (; i < source.length; i++) {
      const c = source[i]!
      const top = stack[stack.length - 1]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = null
      } else if (top === 'template') {
        if (c === '\\') i++
        else if (c === '`') stack.pop()
        else if (c === '$' && source[i + 1] === '{') {
          stack.push('brace')
          i++
        }
      } else if (c === '"' || c === "'") quote = c
      else if (c === '`' && top === 'brace') stack.push('template')
      else if (c === '{') stack.push('brace')
      else if (c === '}') stack.pop()
      else if (c === '>' && stack.length === 0) break
    }
    tags.push({ tag: source.slice(match.index, i + 1), at: match.index })
  }
  return tags
}

/** The `href` attribute's value: a quoted string, or the code inside {…}. */
export function hrefOf(tag: string): string | null {
  const at = tag.search(/\shref=/)
  if (at < 0) return null
  let i = tag.indexOf('=', at) + 1
  const open = tag[i]
  if (open === '"' || open === "'") {
    const end = tag.indexOf(open, i + 1)
    return tag.slice(i, end + 1)
  }
  if (open !== '{') return null
  let depth = 0
  const begin = i + 1
  for (; i < tag.length; i++) {
    if (tag[i] === '{') depth++
    else if (tag[i] === '}' && --depth === 0) break
  }
  return tag.slice(begin, i).trim()
}

const PUBLIC_NAME = /^(?:articleHref|buildArticleHref|publicPath|writerHref)$/

/**
 * Files whose Links take their href from a prop that carries public article
 * or writer paths. A text scan cannot follow a prop, so in these files every
 * Link with a non-literal href must carry the flag.
 */
export const HREF_PROP_FILES: Record<string, string> = {
  'components/articles/ArticleListingThumbnail.tsx':
    'the card thumbnail: href is the article path',
  'components/articles/Pagination.tsx':
    'pages of /articles and of a writer page, both checked by the proxy',
  'components/profile/ProfileTabBar.tsx': "a writer page's tabs",
  'components/profile/ProfileNftCollection.tsx': "a writer page's NFT pages",
}

/**
 * Links the guard does not see, with the reason they stay unflagged. Each
 * file must still exist, so the note stays true.
 */
export const KNOWN_UNFLAGGED: Record<string, string> = {
  'components/layout/AccountMenuDropdown.tsx':
    "the account menu's link to the reader's own writer page (getAccountNavigationLinks): it renders only while the menu is open",
  'components/layout/AppMobileMenu.tsx':
    "the mobile menu's link to the reader's own writer page (getAccountNavigationLinks): it renders only while the menu is open",
}

/**
 * Whether an href goes to a public article or writer page. `routes` are the
 * app's own first path segments (/articles, /settings, …); anything else
 * after `/` is a writer handle.
 */
export function isPublicPagePath(
  href: string,
  source: string,
  routes: ReadonlySet<string>
): boolean {
  // A literal path.
  const literal = /^["'](\/[^"']*)["']$/.exec(href)
  if (literal) {
    const first = literal[1]!.split(/[/?#]/)[1] ?? ''
    return first !== '' && !first.startsWith('#') && !routes.has(first)
  }
  // A template whose first segment is code: /${username}, /${a}/${b}.
  if (/^`\/\$\{/.test(href)) return true
  // A template that starts with a public path helper: `${articleHref(…)}?…`.
  if (/^`\$\{\s*(?:articleHref|buildArticleHref)\s*\(/.test(href)) return true
  // A named helper or value: articleHref(b), getWorkHref(item), href, and
  // the last name of a member path (item.articleHref).
  const name = /^(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(
    href
  )?.[1]
  if (!name) return false
  if (PUBLIC_NAME.test(name)) return true
  // Defined in this file as such a template (const, let or function).
  const definition = new RegExp(
    `(?:const|let|function)\\s+${name}\\b[\\s\\S]{0,400}?\`\\/\\$\\{`
  )
  return definition.test(source)
}

/** Whether the tag turns prefetch off. */
export function hasPrefetchFlag(tag: string): boolean {
  return /\bprefetch=\{[^}]*\bARTICLE_LINK_PREFETCH\b|\bprefetch=\{false\}/.test(
    tag
  )
}

/** Unflagged public-page links in one source file. */
export function findUnflaggedLinks(
  file: string,
  source: string,
  routes: ReadonlySet<string>
): LinkFinding[] {
  const findings: LinkFinding[] = []
  const propFed = file in HREF_PROP_FILES
  for (const { tag, at } of linkTags(source)) {
    const href = hrefOf(tag)
    if (!href || hasPrefetchFlag(tag)) continue
    const fromProp = propFed && !/^["']/.test(href)
    if (!fromProp && !isPublicPagePath(href, source, routes)) continue
    const line = source.slice(0, at).split('\n').length
    findings.push({ file, line, href })
  }
  return findings
}

/** The app's own first path segments, from app/ (route groups included). */
export function appRoutes(appDir: string): Set<string> {
  const routes = new Set(['api', '_next'])
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (!statSync(join(dir, name)).isDirectory()) continue
      if (name.startsWith('(') && name.endsWith(')')) visit(join(dir, name))
      else if (!name.startsWith('[') && !name.startsWith('_')) routes.add(name)
    }
  }
  visit(appDir)
  return routes
}

/** All .tsx files under `dirs`, relative to `root`. */
export function sourceFiles(root: string, dirs: string[]): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.tsx')) files.push(relative(root, path))
    }
  }
  for (const dir of dirs) walk(join(root, dir))
  return files.sort()
}

export function scan(root: string, dirs = ['app', 'components']) {
  const routes = appRoutes(join(root, 'app'))
  return sourceFiles(root, dirs).flatMap((file) =>
    findUnflaggedLinks(file, readFileSync(join(root, file), 'utf8'), routes)
  )
}
