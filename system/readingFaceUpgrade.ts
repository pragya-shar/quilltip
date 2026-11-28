import type { FacePair, ReadingFaceUpgrade } from './fonts'
import { readingStack } from './readingStack'

/**
 * Reading text keeps the face its page view started in (the reading faces
 * use font-display: optional). A view that started in the fallback stays in
 * it, and client navigation never leaves the document, so without this a
 * reader would keep the fallback until the next full load.
 *
 * So: once the page is idle, each reading face this document asked for is
 * loaded again under its second family name (system/fonts.ts), from the
 * HTTP cache. At the next change of page, and only then, the reading
 * variables on <html> lead with the second names of the faces that loaded:
 * the new page paints in Literata. A face this document never asked for
 * (the italic on a page with none) is not loaded, so no page pays for bytes
 * it did not need; it is upgraded after a page that uses it.
 *
 * The family names come from `data-reading-faces` on <html> (written by the
 * root layout from system/fonts.ts). Without it (a page outside the shell's
 * layout, a test fixture) nothing happens.
 */

type PairName = keyof ReadingFaceUpgrade['pairs']

let data: ReadingFaceUpgrade | null | undefined

/** For tests: forget the loaded faces and the data. */
export function resetReadingFaces() {
  loaded.clear()
  data = undefined
  started = false
}
function faces(): ReadingFaceUpgrade | null {
  if (data !== undefined) return data
  try {
    const raw = document.documentElement.dataset.readingFaces
    data = raw ? (JSON.parse(raw) as ReadingFaceUpgrade) : null
  } catch {
    data = null
  }
  return data
}

const loaded = new Set<PairName>()
let started = false

/** The first family of a next/font family list: `'readingFace'`. */
function familyName(list: string): string {
  return (list.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '')
}

/** Whether this document asked for the face: it is no longer unloaded. */
function askedFor(face: FacePair): boolean {
  const name = familyName(face.first)
  for (const font of document.fonts)
    if (
      font.family.replace(/^["']|["']$/g, '') === name &&
      font.status !== 'unloaded'
    )
      return true
  return false
}

function loadNext(name: PairName) {
  const face = faces()?.pairs[name]
  if (!face) return
  if (loaded.has(name) || !askedFor(face)) return
  const font = `${face.italic ? 'italic ' : ''}400 1em ${face.next}`
  // A Latin Extended face loads only for its own letters (unicode-range).
  const text = name.startsWith('extended') ? 'Łđ' : 'a'
  document.fonts
    .load(font, text)
    .then((faces) => {
      if (faces.length === 0) return
      loaded.add(name)
      // What the next change of page will lead with (tests read it).
      document.documentElement.dataset.readingFacesLoaded = [...loaded]
        .sort()
        .join(' ')
    })
    .catch(() => {})
}

function loadAll() {
  const known = faces()
  if (!known) return
  for (const name of Object.keys(known.pairs) as PairName[]) loadNext(name)
}

/**
 * Starts loading the second names when the page is idle, and again after
 * each page arrives (a page may ask for a face the last one did not).
 */
export function prepareReadingFaces() {
  if (typeof document === 'undefined') return
  const idle = (run: () => void) => {
    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(run, { timeout: 4000 })
    else window.setTimeout(run, 1500)
  }
  if (!started) {
    started = true
    if (document.readyState === 'complete') idle(loadAll)
    else window.addEventListener('load', () => idle(loadAll), { once: true })
    return
  }
  idle(loadAll)
}

/**
 * The shell's call at each commit of a page (SheetHost, before it paints):
 * the faces switch only at a change of path, and only with no sheet or
 * panel on screen, whose text would change face where the reader sees it
 * (the next change of page does it). Returns whether a variable changed.
 */
export function upgradeAtPageChange(
  pathChanged: boolean,
  sheetsOnScreen: boolean
): boolean {
  if (!pathChanged || sheetsOnScreen) return false
  return upgradeReadingFaces()
}

/**
 * Lead each reading variable with the second names that loaded; a face
 * whose second name has not loaded keeps its first name. Returns whether it
 * changed one.
 */
export function upgradeReadingFaces(): boolean {
  const known = faces()
  if (!known || loaded.size === 0) return false
  const root = document.documentElement
  const name = (pair: PairName) =>
    loaded.has(pair) ? known.pairs[pair].next : known.pairs[pair].first
  let changed = false
  for (const [variable, [latin, extended, fallback]] of Object.entries(
    known.lists
  )) {
    const list = readingStack(name(latin), name(extended), fallback)
    if (root.style.getPropertyValue(variable) !== list) {
      root.style.setProperty(variable, list)
      changed = true
    }
  }
  return changed
}
