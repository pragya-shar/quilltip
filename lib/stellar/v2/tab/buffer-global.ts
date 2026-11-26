/**
 * `encoding.ts` calls the global `Buffer`, which browsers do not have. Next.js
 * webpack builds inject it; other bundlers (Turbopack, Bun, Vite) may not.
 * Importing this module first makes the tab modules independent of that.
 * It only fills a missing global and never replaces an existing one.
 */
import { Buffer } from 'buffer'

const scope = globalThis as { Buffer?: unknown }
if (typeof scope.Buffer === 'undefined') scope.Buffer = Buffer

export {}
