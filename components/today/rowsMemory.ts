import { SESSION_ATTR } from '@/shell/prePaint'

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

/** Sets or clears a row's reservation on <html>. */
export function reserve(root: HTMLElement, kind: RowKind, on: boolean) {
  if (on) root.setAttribute(RESERVE_ATTR[kind], '')
  else root.removeAttribute(RESERVE_ATTR[kind])
}

/**
 * What to reserve now. "Your place" belongs to this browser, signed in or
 * not: reserved whenever an unfinished place is stored, which is known
 * before the first paint, so it never moves the page. "Your draft" comes
 * from the server after the first paint: reserved when the shell's pre-paint
 * script marked a held session (`data-session="held"` on <html>) and the
 * row showed last time. One source for "signed in before paint".
 */
export function reservation(
  sessionHeld: boolean,
  storage: Storage,
  hasPlace: boolean
): RowsMemory {
  return {
    place: hasPlace,
    draft: sessionHeld && readRowsMemory(storage).draft,
  }
}

/** Whether the shell's pre-paint script marked a held session. */
export function sessionHeld(root: HTMLElement): boolean {
  return root.getAttribute(SESSION_ATTR) === 'held'
}

/**
 * The pre-paint script, as text, run inline before Today's content is
 * parsed, after the shell's pre-paint script in the head. It does what
 * `reservation` and `reserve` do (with `currentPlace`
 * from resume.ts reduced to "an unfinished, started entry with a
 * title and a path"), in plain ES5, and never throws.
 */
export function reserveScript(readingKey: string): string {
  const j = JSON.stringify
  return (
    // o(h): the same test as isSitePath in readingPlace.ts.
    `try{var o=function(h){if(typeof h!=='string'||h.charAt(0)!=='/'||h.charAt(1)==='/')return false;for(var j=0;j<h.length;j++){var c=h.charCodeAt(j);if(c<32||c===127||c===92)return false}try{return new URL(h,'https://site.invalid').origin==='https://site.invalid'}catch(x){return false}};` +
    `var s=localStorage,r=document.documentElement,h=false,i,n,p=JSON.parse(s.getItem(${j(readingKey)})||'[]');` +
    `if(p&&p.length)for(i=0,n=0;i<p.length&&n<20;i++){var e=p[i];if(!(e&&typeof e==='object'&&typeof e.articleId==='string'&&e.articleId&&o(e.href)&&typeof e.title==='string'&&typeof e.percent==='number'&&isFinite(e.percent)&&typeof e.updatedAt==='number'&&isFinite(e.updatedAt)))continue;n++;if(e.finished!==true&&e.percent>0&&e.title.replace(/\\s/g,'')){h=true;break}}` +
    `if(h)r.setAttribute(${j(RESERVE_ATTR.place)},'');` +
    `if(r.getAttribute(${j(SESSION_ATTR)})==='held'&&(JSON.parse(s.getItem(${j(ROWS_MEMORY_KEY)})||'null')||{}).draft===true)r.setAttribute(${j(RESERVE_ATTR.draft)},'')}catch(e){}`
  )
}
