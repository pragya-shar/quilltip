/**
 * JSON Canonicalization Scheme (RFC 8785).
 *
 * Pure and dependency-free, so the Convex runtime, Node and the browser all
 * produce the same string for the same value:
 *
 * - Object keys are sorted by their UTF-16 code units, recursively.
 * - No whitespace is emitted.
 * - Numbers use the ECMAScript number-to-string rules (`-0` becomes `0`).
 * - Strings are escaped as `JSON.stringify` escapes them: `"`, `\`, and the
 *   control characters below U+0020 only. Other characters are emitted as is;
 *   no Unicode normalisation is applied.
 *
 * Values outside I-JSON (RFC 7493) are rejected instead of being coerced:
 * `NaN`, `Infinity`, lone surrogates, `undefined`, functions, symbols, bigints,
 * non-plain objects and cycles all throw `CanonicalJsonError`.
 */

export class CanonicalJsonError extends Error {
  constructor(message: string, path: string) {
    super(`${message} at ${path || '$'}`)
    this.name = 'CanonicalJsonError'
  }
}

const LONE_SURROGATE = /\p{Cs}/u

function serializeString(value: string, path: string): string {
  if (LONE_SURROGATE.test(value)) {
    throw new CanonicalJsonError('String contains a lone surrogate', path)
  }
  return JSON.stringify(value)
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function serialize(value: unknown, path: string, ancestors: object[]): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError('Number is not finite', path)
      }
      // ECMAScript Number serialisation, which RFC 8785 adopts. JSON.stringify
      // already maps -0 to "0".
      return JSON.stringify(value)
    case 'string':
      return serializeString(value, path)
    case 'object':
      break
    default:
      throw new CanonicalJsonError(`Unsupported ${typeof value} value`, path)
  }

  const node = value as object
  if (ancestors.includes(node)) {
    throw new CanonicalJsonError('Value contains a cycle', path)
  }
  ancestors.push(node)
  try {
    if (Array.isArray(node)) {
      const items: string[] = []
      for (let i = 0; i < node.length; i++) {
        if (!(i in node)) {
          throw new CanonicalJsonError('Array has a hole', `${path}[${i}]`)
        }
        items.push(serialize(node[i], `${path}[${i}]`, ancestors))
      }
      return `[${items.join(',')}]`
    }
    if (!isPlainObject(node)) {
      throw new CanonicalJsonError('Only plain objects are allowed', path)
    }
    // Default sort compares UTF-16 code units, as RFC 8785 section 3.2.3 requires.
    const keys = Object.keys(node).sort()
    const members: string[] = []
    for (const key of keys) {
      const memberPath = `${path}.${key}`
      members.push(
        `${serializeString(key, memberPath)}:${serialize(node[key], memberPath, ancestors)}`
      )
    }
    return `{${members.join(',')}}`
  } finally {
    ancestors.pop()
  }
}

/** The RFC 8785 canonical JSON text of `value`. */
export function canonicalJson(value: unknown): string {
  return serialize(value, '', [])
}

/** UTF-8 bytes of the RFC 8785 canonical JSON text of `value`. */
export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value))
}
