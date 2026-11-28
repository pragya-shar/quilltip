// A source guard for #630: every `next/link` Link to a public article or
// writer page carries `prefetch={ARTICLE_LINK_PREFETCH}`, and no code calls
// `.prefetch(…)` with such a path. Each prefetch of such a page runs the
// proxy's route check and renders the page, so one unflagged card costs
// backend reads for every card in view.
//
// It scans app/, components/, lib/ and hooks/ (.ts and .tsx). It reads the
// Link element under any default import name from `next/link`, and an href
// that is:
// - a literal path, a template or a `'/' + …` concatenation starting with a
//   handle, or an object with such a `pathname`;
// - `articleHref(…)` and similar helpers (PUBLIC_NAME);
// - a choice (`a ? b : c`, `a ?? b`, `a || b`) with such a branch;
// - a name defined in the same file as such a value: `const href =
//   articleHref(…)`, through further names (`const href = target`), a
//   function or arrow that returns one, or, for a member path
//   (`item.href`), an object property `href: …` in the file.
//
// Limits, by design of a text scan:
// - an href built by a helper imported from another module and not in
//   PUBLIC_NAME (`href={toArticle(u, s)}`) is not seen;
// - an href that arrives as a prop (`href={href}` from `{ href }`) or from
//   runtime data (a path read from the query string or storage) is not
//   seen; a component that wraps Link and forwards its href is caught only
//   in the prop-fed files listed in HREF_PROP_FILES;
// - an href from a destructured binding (`const { href } = item`), an
//   array, a spread (`<Link {...props}>`) or a reassigned `let` is not
//   followed;
// - a member path is matched by its last name only, so `item.href` takes
//   any `href:` property in the file; this can flag too much, never less;
// - a plain `<a>` is not scanned: Next.js does not prefetch it.

import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

export type LinkFinding = { file: string; line: number; href: string }

/** `Link` and any default import name of `next/link` in the source. */
export function linkNames(source: string): string[] {
  const names = new Set(['Link'])
  const imports =
    /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]next\/link['"]/g
  for (const match of source.matchAll(imports)) names.add(match[1]!)
  return [...names]
}

/** Opening `<Link …>` tags of a source file, with their offset. */
export function linkTags(source: string): { tag: string; at: number }[] {
  const tags: { tag: string; at: number }[] = []
  const start = new RegExp(`<(?:${linkNames(source).join('|')})\\b`, 'g')
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
  routes: ReadonlySet<string>,
  seen: Set<string> = new Set()
): boolean {
  href = unwrap(href)
  // A choice (a ? b : c, a ?? b, a || b): public when any branch is.
  const branches = alternatives(href)
  if (branches.length > 1)
    return branches.some((b) => isPublicPagePath(b, source, routes, seen))
  // An object href: its pathname decides.
  if (href.startsWith('{')) {
    const pathname = valueAfter(href, /\bpathname\s*:\s*/)
    return pathname !== null && isPublicPagePath(pathname, source, routes, seen)
  }
  // A literal path.
  const literal = /^["'](\/[^"']*)["']$/.exec(href)
  if (literal) {
    const first = literal[1]!.split(/[/?#]/)[1] ?? ''
    return first !== '' && !first.startsWith('#') && !routes.has(first)
  }
  // A concatenation that starts with a literal: '/' + username, '/x/' + y.
  const head = /^(["'`])(\/[^"'`$]*)\1\s*\+/.exec(href)
  if (head) {
    const first = head[2]!.slice(1).split(/[/?#]/)[0]!
    return first === '' || !routes.has(first)
  }
  // A template whose first segment is code: /${username}, /${a}/${b}.
  if (/^`\/\$\{/.test(href)) return true
  // A template that starts with a public path helper: `${articleHref(…)}?…`.
  if (/^`\$\{\s*(?:articleHref|buildArticleHref)\s*\(/.test(href)) return true
  // A named helper or value: articleHref(b), getWorkHref(item), href, and
  // the last name of a member path (item.articleHref).
  const named =
    /^((?:[A-Za-z_$][\w$]*\??\.)*)([A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(href)
  const name = named?.[2]
  if (!name) return false
  if (PUBLIC_NAME.test(name)) return true
  // Defined in this file as such a template (const, let or function).
  const definition = new RegExp(
    `(?:const|let|function)\\s+${name}\\b[\\s\\S]{0,400}?\`\\/\\$\\{`
  )
  if (definition.test(source)) return true
  // Bound in this file to another expression: const href = articleHref(…),
  // const a = b, a function or arrow that returns one, and, for a member
  // path (item.href), an object property `href: …`. Followed by name, once.
  if (seen.has(name)) return false
  seen.add(name)
  const bound = [
    ...bindingsOf(name, source),
    ...(named![1] ? propertiesOf(name, source) : []),
  ]
  return bound.some((value) => isPublicPagePath(value, source, routes, seen))
}

/** `code` without surrounding parentheses or a trailing `as …` cast. */
function unwrap(code: string): string {
  code = code.trim().replace(/\s+as\s+[\w$.<>[\]| ]+$/, '')
  while (code.startsWith('(') && closing(code, 0) === code.length - 1)
    code = code.slice(1, -1).trim()
  return code
}

/** The index of the bracket that closes the one at `open`, or -1. */
function closing(code: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < code.length; i++) {
    const c = code[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '{' || c === '[') depth++
    else if ((c === ')' || c === '}' || c === ']') && --depth === 0) return i
  }
  return -1
}

/**
 * The branches of a top-level choice: both results of `a ? b : c`, or each
 * side of `a ?? b` and `a || b`. One element when there is no choice.
 */
export function alternatives(code: string): string[] {
  const top: { at: number; op: string }[] = []
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < code.length; i++) {
    const c = code[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') depth--
    else if (depth > 0) continue
    else if (code.startsWith('??', i) || code.startsWith('||', i)) {
      top.push({ at: i, op: code.slice(i, i + 2) })
      i++
    } else if (
      c === '?' &&
      code[i + 1] === '.' &&
      !/\d/.test(code[i + 2] ?? '')
    )
      i++ // optional chaining
    else if (c === '?' || c === ':') top.push({ at: i, op: c })
  }
  const ternary = top.findIndex((t) => t.op === '?')
  if (ternary >= 0) {
    // The `:` that matches this `?`, past any nested ternary.
    let open = 0
    for (const t of top.slice(ternary + 1)) {
      if (t.op === '?') open++
      else if (t.op === ':' && open-- === 0)
        return [
          ...alternatives(unwrap(code.slice(top[ternary]!.at + 1, t.at))),
          ...alternatives(unwrap(code.slice(t.at + 1))),
        ]
    }
    return [code]
  }
  const logical = top.filter((t) => t.op === '??' || t.op === '||')
  if (!logical.length) return [code]
  const parts: string[] = []
  let from = 0
  for (const t of logical) {
    parts.push(code.slice(from, t.at))
    from = t.at + 2
  }
  parts.push(code.slice(from))
  return parts.flatMap((part) => alternatives(unwrap(part)))
}

/**
 * What `name` is bound to in `source`: the value of `const|let|var name =`,
 * and what a function or arrow of that name returns.
 */
export function bindingsOf(name: string, source: string): string[] {
  const values: string[] = []
  const binding = new RegExp(
    `\\b(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=(?!=)\\s*`,
    'g'
  )
  for (const match of source.matchAll(binding)) {
    const value = expressionAt(source, match.index! + match[0].length)
    // An arrow: its expression body, or the returns of its block body.
    const arrow = /^(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+)?=>\s*/.exec(
      value
    )
    if (!arrow) values.push(value)
    else {
      const body = value.slice(arrow[0].length)
      values.push(...(body.startsWith('{') ? returnsOf(body) : [body]))
    }
  }
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(`, 'g')
  for (const match of source.matchAll(declaration)) {
    const params = match.index! + match[0].length - 1
    const open = source.indexOf('{', closing(source, params))
    const end = closing(source, open)
    if (open >= 0 && end > open)
      values.push(...returnsOf(source.slice(open, end + 1)))
  }
  return values
}

/** Object properties `name: value` in `source` (not type annotations). */
export function propertiesOf(name: string, source: string): string[] {
  const property = new RegExp(`[{,]\\s*${name}\\s*:\\s*`, 'g')
  return [...source.matchAll(property)].map((match) =>
    expressionAt(source, match.index! + match[0].length)
  )
}

/** The expressions after each `return` in a block. */
function returnsOf(block: string): string[] {
  return [...block.matchAll(/\breturn\s+/g)].map((match) =>
    expressionAt(block, match.index! + match[0].length)
  )
}

/**
 * The expression that starts at `begin`: up to a top-level `;` or `,`, the
 * end of the enclosing brackets, or a line break after which it does not go
 * on (the next line does not start with an operator, and this one does not
 * end with one).
 */
export function expressionAt(code: string, begin: number): string {
  let depth = 0
  let quote: string | null = null
  let i = begin
  for (; i < code.length; i++) {
    const c = code[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) break
      depth--
    } else if (depth > 0) continue
    else if (c === ';' || c === ',') break
    else if (c === '\n') {
      const before = code.slice(begin, i).trimEnd()
      const after = code.slice(i + 1).trimStart()
      if (
        before !== '' &&
        !/(?:[?:+|&=.(,]|=>)$/.test(before) &&
        !/^(?:[?:.+|&]|\?\?)/.test(after)
      )
        break
    }
  }
  return code.slice(begin, i).trim()
}

/**
 * The expression after `key` in `code`, up to the next top-level `,` or the
 * end of the enclosing braces or parentheses.
 */
export function valueAfter(code: string, key: RegExp): string | null {
  const match = key.exec(code)
  if (!match) return null
  let depth = 0
  let quote: string | null = null
  let i = match.index + match[0].length
  const begin = i
  for (; i < code.length; i++) {
    const c = code[i]!
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') {
      if (depth === 0) break
      depth--
    } else if (c === ',' && depth === 0) break
  }
  return code.slice(begin, i).trim()
}

/** `.prefetch(path)` calls (router.prefetch) with a public page path. */
export function findPrefetchCalls(
  file: string,
  source: string,
  routes: ReadonlySet<string>
): LinkFinding[] {
  const findings: LinkFinding[] = []
  const call = /\.prefetch\(\s*/g
  let match: RegExpExecArray | null
  while ((match = call.exec(source))) {
    const arg = valueAfter(source.slice(match.index), /\.prefetch\(\s*/)
    if (!arg || !isPublicPagePath(arg, source, routes)) continue
    const line = source.slice(0, match.index).split('\n').length
    findings.push({ file, line, href: `.prefetch(${arg})` })
  }
  return findings
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

/** All .ts and .tsx files under `dirs`, relative to `root`. */
export function sourceFiles(root: string, dirs: string[]): string[] {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name))
        files.push(relative(root, path))
    }
  }
  for (const dir of dirs) walk(join(root, dir))
  return files.sort()
}

export const SCANNED_DIRS = ['app', 'components', 'lib', 'hooks']

export function scan(root: string, dirs = SCANNED_DIRS) {
  const routes = appRoutes(join(root, 'app'))
  return sourceFiles(root, dirs).flatMap((file) => {
    const source = readFileSync(join(root, file), 'utf8')
    return [
      ...findUnflaggedLinks(file, source, routes),
      ...findPrefetchCalls(file, source, routes),
    ]
  })
}
