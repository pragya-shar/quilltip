/**
 * Vitest setup that removes the global `Buffer`, as the Convex default
 * runtime has none. Modules must import it from `buffer`.
 */
delete (globalThis as { Buffer?: unknown }).Buffer
