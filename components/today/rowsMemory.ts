/**
 * Which of Today's two rows ("Your place", "Your draft") this browser showed
 * last time, so their space is reserved before the first paint and filling
 * them moves nothing (CLS). The pre-paint script (`reserveScript`) reads the
 * same key and sets the same attributes; the rows island keeps both current.
 */
export const ROWS_MEMORY_KEY = 'quilltip:today-rows:v1'

/** Attributes on <html> that reserve each row's space (see today.css). */
export const RESERVE_ATTR = {
  place: 'data-today-place',
  draft: 'data-today-draft',
} as const

export type RowKind = keyof typeof RESERVE_ATTR
export type RowsMemory = Record<RowKind, boolean>

const NONE: RowsMemory = { place: false, draft: false }

/** Convex Auth keeps its token under keys that start with this. */
const AUTH_TOKEN_PREFIX = '__convexAuthJWT'

export function readRowsMemory(storage: Storage): RowsMemory {
  try {
    const value = JSON.parse(storage.getItem(ROWS_MEMORY_KEY) ?? 'null') as {
      place?: unknown
      draft?: unknown
    } | null
    if (!value || typeof value !== 'object') return NONE
    return { place: value.place === true, draft: value.draft === true }
  } catch {
    return NONE
  }
}

export function writeRowsMemory(storage: Storage, memory: RowsMemory) {
  try {
    if (!memory.place && !memory.draft) storage.removeItem(ROWS_MEMORY_KEY)
    else storage.setItem(ROWS_MEMORY_KEY, JSON.stringify(memory))
  } catch {
    // Storage blocked: rows still show after navigation; nothing breaks.
  }
}

/** Whether this browser holds a session token at all (signed in, or was). */
export function hasAuthToken(storage: Storage): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(AUTH_TOKEN_PREFIX)) return true
    }
  } catch {
    // Storage blocked.
  }
  return false
}

/** Sets or clears a row's reservation on <html>. */
export function reserve(root: HTMLElement, kind: RowKind, on: boolean) {
  if (on) root.setAttribute(RESERVE_ATTR[kind], '')
  else root.removeAttribute(RESERVE_ATTR[kind])
}

/**
 * What to reserve now. "Your place" belongs to this browser, signed in or
 * not: reserved whenever an unfinished place is stored, which is known
 * before the first paint, so it never moves the page. "Your draft" comes
 * from the server after the first paint: reserved when this browser holds a
 * session token and showed the row last time.
 */
export function reservation(storage: Storage, hasPlace: boolean): RowsMemory {
  return {
    place: hasPlace,
    draft: hasAuthToken(storage) && readRowsMemory(storage).draft,
  }
}

/**
 * The pre-paint script, as text, run inline before Today's content is
 * parsed. It does what `reservation` and `reserve` do (with `currentPlace`
 * from resume.ts reduced to "an unfinished, started entry with a
 * title and a path"), in plain ES5, and never throws.
 */
export function reserveScript(readingKey: string): string {
  const j = JSON.stringify
  return (
    `try{var s=localStorage,r=document.documentElement,t=false,h=false,i,p=JSON.parse(s.getItem(${j(readingKey)})||'[]');` +
    `if(p&&p.length)for(i=0;i<p.length&&i<20;i++){var e=p[i];if(e&&typeof e.articleId==='string'&&e.articleId&&e.finished!==true&&typeof e.percent==='number'&&e.percent>0&&typeof e.updatedAt==='number'&&typeof e.title==='string'&&e.title.replace(/\\s/g,'')&&typeof e.href==='string'&&e.href.charAt(0)==='/'&&e.href.charAt(1)!=='/'){h=true;break}}` +
    `if(h)r.setAttribute(${j(RESERVE_ATTR.place)},'');` +
    `for(i=0;i<s.length;i++){if((s.key(i)||'').indexOf(${j(AUTH_TOKEN_PREFIX)})===0){t=true;break}}` +
    `if(t&&(JSON.parse(s.getItem(${j(ROWS_MEMORY_KEY)})||'null')||{}).draft===true)r.setAttribute(${j(RESERVE_ATTR.draft)},'')}catch(e){}`
  )
}
