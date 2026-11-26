/** Lowercase hex helpers with strict input checks. */
import { TabClientError } from './errors'

const HEX = /^(?:[0-9a-f]{2})*$/

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Parses lowercase or uppercase hex; `length` is the byte count, if fixed. */
export function hexToBytes(hex: string, length?: number, name = 'value') {
  const value = typeof hex === 'string' ? hex.toLowerCase() : ''
  if (!HEX.test(value) || (length !== undefined && value.length !== length * 2))
    throw new TabClientError(
      'INVALID_INPUT',
      length === undefined
        ? `${name} must be hex`
        : `${name} must be ${length} bytes of hex`
    )
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function isHexOfLength(value: unknown, length: number): boolean {
  return (
    typeof value === 'string' &&
    value.length === length * 2 &&
    HEX.test(value.toLowerCase())
  )
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/** Non-negative decimal integer string, as Convex stores i128 amounts. */
export function parseAmount(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,38})$/.test(value))
    throw new TabClientError(
      'INVALID_INPUT',
      `${name} must be a decimal integer`
    )
  return BigInt(value)
}
