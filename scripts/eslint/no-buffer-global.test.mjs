import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import tseslint from 'typescript-eslint'
import rule from './no-buffer-global.mjs'

RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser },
})

tester.run('no-buffer-global', rule, {
  valid: [
    "import { Buffer } from 'buffer'; Buffer.from('a')",
    "'use node'\nBuffer.from('a')",
    '"use node"; const b = Buffer.alloc(1)',
    'function f(Buffer) { return Buffer.from("a") }',
    'type T = Buffer; const x: Buffer | null = null',
    'const a = new ArrayBuffer(1)',
  ],
  invalid: [
    { code: "Buffer.from('a')", errors: [{ messageId: 'global' }] },
    {
      code: "/** doc */\nconst h = (b: Uint8Array) => Buffer.from(b).toString('hex')",
      errors: [{ messageId: 'global' }],
    },
    {
      code: "const x = 1\n'use node'\nBuffer.from('a')",
      errors: [{ messageId: 'global' }],
    },
    {
      code: 'globalThis.x = Buffer; Buffer.concat([])',
      errors: [{ messageId: 'global' }, { messageId: 'global' }],
    },
  ],
})
