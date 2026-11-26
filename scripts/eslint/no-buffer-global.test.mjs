import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import rule from './no-buffer-global.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
})

const err = { messageId: 'global' }

tester.run('no-buffer-global', rule, {
  valid: [
    "import { Buffer } from 'buffer'; Buffer.from('a')",
    "'use node'\nBuffer.from('a')",
    '"use node"; const b = Buffer.alloc(1)',
    "'use node'\nglobalThis.Buffer.from('a')",
    'function f(Buffer) { return Buffer.from("a") }',
    'type T = Buffer; const x: Buffer | null = null',
    'const a = new ArrayBuffer(1)',
    // Feature checks.
    "if (typeof Buffer !== 'undefined') {}",
    "if (typeof globalThis.Buffer === 'function') {}",
    // Other properties and shadowed objects.
    'globalThis.crypto.getRandomValues(new Uint8Array(1))',
    'const { crypto } = globalThis',
    'function f(window) { return window.Buffer }',
    'const self = { Buffer: 1 }; self.Buffer',
    'const global = { ok: true }; global.ok',
  ],
  invalid: [
    { code: "Buffer.from('a')", errors: [err] },
    {
      code: "/** doc */\nconst h = (b: Uint8Array) => Buffer.from(b).toString('hex')",
      errors: [err],
    },
    { code: "const x = 1\n'use node'\nBuffer.from('a')", errors: [err] },
    { code: 'globalThis.x = Buffer; Buffer.concat([])', errors: [err, err] },
    { code: "globalThis.Buffer.from('a')", errors: [err] },
    { code: "globalThis['Buffer'].from('a')", errors: [err] },
    { code: 'globalThis[`Buffer`]', errors: [err] },
    { code: 'const { Buffer } = globalThis', errors: [err] },
    { code: 'const { Buffer: B } = globalThis', errors: [err] },
    { code: "const { 'Buffer': B } = globalThis", errors: [err] },
    { code: 'let B; ({ Buffer: B } = globalThis)', errors: [err] },
    { code: "global.Buffer.from('a')", errors: [err] },
    { code: "self.Buffer.from('a')", errors: [err] },
    { code: "window.Buffer.from('a')", errors: [err] },
    {
      code: 'const B = globalThis.Buffer',
      languageOptions: { globals: { globalThis: 'readonly' } },
      errors: [err],
    },
    {
      code: "Buffer.from('a')",
      languageOptions: { globals: { Buffer: 'readonly' } },
      errors: [err],
    },
  ],
})
