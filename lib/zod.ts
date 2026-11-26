/**
 * Zod for app code. Import `z` from here, not from 'zod'.
 *
 * Zod compiles object parsers with `new Function` unless `jitless` is set, and
 * probes for it with `Function("")` on first parse. The content security
 * policy blocks both (`script-src` has no 'unsafe-eval'), so the probe fails,
 * Zod falls back to its interpreter, and the browser reports a violation.
 * Setting `jitless` here skips the probe. Parsing behaves the same.
 */
import { config, z } from 'zod'

config({ jitless: true })

export { z }
