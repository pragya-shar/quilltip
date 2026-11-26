/**
 * Vitest setup for convex-test suites that run in the `edge-runtime`
 * environment.
 *
 * `@edge-runtime/vm` replaces `globalThis.Uint8Array` with a Proxy so that
 * `instanceof` also accepts arrays created in the Node.js realm. Arrays built
 * with `new Uint8Array()` still report the native constructor, so a check like
 * `bytes.constructor === Uint8Array` fails. The Stellar SDK's strkey decoder
 * makes that check, while the Convex runtime has no such Proxy.
 *
 * Restore the native constructor and keep the cross-realm `instanceof`.
 */
const realmU8 = globalThis.Uint8Array
const nativeU8 = Object.getPrototypeOf(new realmU8(0)).constructor as
  | Uint8ArrayConstructor
  | undefined
const nodeU8 = (globalThis as Record<symbol, unknown>)[
  Symbol.for('node:Uint8Array')
] as Uint8ArrayConstructor | undefined

if (nativeU8 && nativeU8 !== realmU8) {
  const isInstance = Function.prototype[Symbol.hasInstance]
  Object.defineProperty(nativeU8, Symbol.hasInstance, {
    configurable: true,
    value: (value: unknown) =>
      isInstance.call(nativeU8, value) ||
      (nodeU8 !== undefined && isInstance.call(nodeU8, value)),
  })
  globalThis.Uint8Array = nativeU8
}
