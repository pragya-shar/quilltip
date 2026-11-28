import { APP_ROUTE_SEGMENTS } from '../routing/publicContentPath'

export const HANDLE_MIN_LENGTH = 3
export const HANDLE_MAX_LENGTH = 30
/** How many past handles a writer can hold; each keeps redirecting to them. */
export const MAX_RETIRED_HANDLES = 5

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]*$/

// Names that would read as part of Quilltip itself, on top of the app routes.
const RESERVED_HANDLES = new Set([
  'admin',
  'api',
  'help',
  'quilltip',
  'root',
  'staff',
  'system',
  // Paths of the application's structure, reserved before they ship.
  'lines',
  'pocket',
  'search',
  'shelf',
  'signin',
  'today',
  'you',
])

// Handles given to new accounts until the writer picks one (see convex/auth.ts).
const GENERATED_HANDLE_PATTERN = /^q[0-9a-f]{19}$/

/** True for a handle Quilltip generated at signup, not one the writer chose. */
export function isGeneratedHandle(handle: string) {
  return GENERATED_HANDLE_PATTERN.test(handle)
}

/**
 * A handle-shaped starting point from a display name, e.g. "Anaïs O'Neil" →
 * "anais_oneil". Returns null when the name has nothing usable.
 */
export function handleBaseFromName(name: string | null | undefined) {
  const base = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, HANDLE_MAX_LENGTH - 2)
    .replace(/_+$/g, '')
  return base.length >= HANDLE_MIN_LENGTH ? base : null
}

/** Uniqueness and redirects ignore letter case. */
export function handleKey(handle: string) {
  return handle.toLowerCase()
}

/** Returns a message to show the writer, or null when the handle is allowed. */
export function handleFormatError(handle: string): string | null {
  if (handle.length < HANDLE_MIN_LENGTH || handle.length > HANDLE_MAX_LENGTH) {
    return `Use ${HANDLE_MIN_LENGTH} to ${HANDLE_MAX_LENGTH} characters.`
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return 'Use letters, numbers and underscores only, starting with a letter or number.'
  }
  const key = handleKey(handle)
  if (APP_ROUTE_SEGMENTS.has(key) || RESERVED_HANDLES.has(key)) {
    return 'That handle is reserved.'
  }
  return null
}
