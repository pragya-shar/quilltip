import { existsSync } from 'node:fs'
import path from 'node:path'

/** The legacy writer page, until the shell's replaces it. */
export const LEGACY_WRITER_PAGE = 'app/(legacy)/[username]/page.tsx'

/**
 * Whether the legacy writer page serves `/{handle}`, read from the route tree
 * at build (next.config.ts). The proxy sends that page's font preloads only
 * then, so they stop with no edit when the shell's writer page replaces it.
 * Node only; the proxy reads QUILLTIP_LEGACY_WRITER_PAGE.
 */
export function legacyWriterPageServes(root = process.cwd()): boolean {
  return existsSync(path.join(root, LEGACY_WRITER_PAGE))
}
