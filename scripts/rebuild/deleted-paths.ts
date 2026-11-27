import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The paths the rebuild deleted (rule R6: a merge never brings one back).
 * Each package owns one file in scripts/rebuild/deleted/ and appends the
 * files and directories it deleted; this reads them all.
 */
export const DELETED_DIR = path.join(__dirname, 'deleted')

/** The listed paths in one file's text, without comments and blank lines. */
export function parseDeletedPaths(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

/** Every listed path, with the package file that lists it. */
export function deletedPaths(
  dir = DELETED_DIR
): { path: string; listedIn: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.txt'))
    .sort()
    .flatMap((name) =>
      parseDeletedPaths(readFileSync(path.join(dir, name), 'utf8')).map(
        (entry) => ({ path: entry, listedIn: name })
      )
    )
}
