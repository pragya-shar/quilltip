/**
 * Steps that run once, right after a sign-in made in this browser, before
 * the person is handed back: for example, offering the drafts saved on
 * this device. A package registers its step; the sign-in runs them all at
 * once. Each step is bounded in time and none can block the person: a step
 * that is slow is left behind at its bound, one that fails is skipped, and
 * the sign-in carries on. A step may return one sentence to tell the person
 * (shown as a toast); it never acts on an intent, which waits for its own
 * press.
 */
export type AfterSignInStep = {
  /** Unique; shown in the log when the step fails or is left behind. */
  name: string
  /** Its own bound, in ms; never more than AFTER_SIGN_IN_MAX_MS. */
  timeoutMs?: number
  run: () => Promise<string | null> | string | null
}

/** The longest any step may hold the person after sign-in. */
export const AFTER_SIGN_IN_MAX_MS = 5_000

const steps = new Map<string, AfterSignInStep>()

/** Adds a step (or replaces the one with the same name). Returns a way to
 * remove it. */
export function registerAfterSignIn(step: AfterSignInStep): () => void {
  steps.set(step.name, step)
  return () => {
    if (steps.get(step.name) === step) steps.delete(step.name)
  }
}

const LEFT_BEHIND = Symbol('left behind')

/**
 * Runs every registered step at once and resolves within the longest
 * bound, with the sentences the steps that finished in time returned, in
 * registration order.
 */
export async function runAfterSignIn(
  registered: Iterable<AfterSignInStep> = steps.values()
): Promise<string[]> {
  const list = [...registered]
  const outcomes = await Promise.all(
    list.map(async (step) => {
      const bound = Math.min(
        step.timeoutMs ?? AFTER_SIGN_IN_MAX_MS,
        AFTER_SIGN_IN_MAX_MS
      )
      let timer: ReturnType<typeof setTimeout> | undefined
      const late = new Promise<typeof LEFT_BEHIND>((resolve) => {
        timer = setTimeout(() => resolve(LEFT_BEHIND), bound)
      })
      try {
        const result = await Promise.race([
          Promise.resolve().then(step.run),
          late,
        ])
        if (result === LEFT_BEHIND) {
          console.warn(`After sign-in step "${step.name}" was left behind`)
          return null
        }
        return typeof result === 'string' && result.trim() ? result : null
      } catch (error) {
        console.error(`After sign-in step "${step.name}" failed`, error)
        return null
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return outcomes.filter((text): text is string => text !== null)
}
