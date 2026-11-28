import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { LegacyRouteTree } from './legacyRoutes'

/** Whether a directory serves something: a page or a route below it. */
function serves(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return serves(full)
    return /^(page|route)\.(tsx?|jsx?)$/.test(name)
  })
}

/**
 * The legacy route tree, read at build (next.config.ts): whether
 * app/(legacy) serves `/`, its top-level segments, and writer pages. Groups
 * are walked through. Node only.
 */
export function legacyRouteTree(
  dir = path.join(process.cwd(), 'app/(legacy)')
): LegacyRouteTree {
  const tree: LegacyRouteTree = { home: false, segments: [], writer: false }
  const walk = (at: string) => {
    let names: string[]
    try {
      names = readdirSync(at)
    } catch {
      return
    }
    for (const name of names) {
      const full = path.join(at, name)
      if (!statSync(full).isDirectory()) {
        if (/^page\.(tsx?|jsx?)$/.test(name)) tree.home = true
        continue
      }
      if (/^\(.*\)$/.test(name)) walk(full)
      else if (name === '[username]') tree.writer = serves(full)
      else if (!/^[[_@]/.test(name) && serves(full)) tree.segments.push(name)
    }
  }
  walk(dir)
  tree.segments.sort()
  return tree
}
