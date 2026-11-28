import { useEffect } from 'react'

/**
 * Parts of the page there must be one of: the toast region (a second draws
 * every toast twice, each with its own timer) and the dock (a second clears
 * the toast lift when either goes). A count per name; the second mount is
 * an error in development, so a surface that mounts its own is caught when
 * it is built. Nothing in production.
 */
export function createMountCounter(report: (message: string) => void) {
  const counts = new Map<string, number>()
  return {
    mount(name: string) {
      const count = (counts.get(name) ?? 0) + 1
      counts.set(name, count)
      if (count > 1)
        report(
          `${name} is mounted ${count} times; the page needs exactly one. Use the shell's.`
        )
      return () => {
        counts.set(name, (counts.get(name) ?? 1) - 1)
      }
    },
  }
}

const counter = createMountCounter((message) => console.error(message))

/** Reports a second mount of `name` in development. */
export function useOnlyOne(name: string) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    return counter.mount(name)
  }, [name])
}
