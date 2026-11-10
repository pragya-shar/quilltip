// Adapted from the JavaScript fallback in bigint-buffer 1.1.5.
// https://unpkg.com/bigint-buffer@1.1.5/dist/browser.js

function toBigIntBE(buffer) {
  const hex = buffer.toString('hex')
  return hex.length === 0 ? BigInt(0) : BigInt(`0x${hex}`)
}

function toBigIntLE(buffer) {
  return toBigIntBE(Buffer.from(buffer).reverse())
}

function toBufferBE(value, width) {
  const hex = value.toString(16)
  return Buffer.from(hex.padStart(width * 2, '0').slice(0, width * 2), 'hex')
}

function toBufferLE(value, width) {
  return toBufferBE(value, width).reverse()
}

exports.toBigIntBE = toBigIntBE
exports.toBigIntLE = toBigIntLE
exports.toBufferBE = toBufferBE
exports.toBufferLE = toBufferLE
