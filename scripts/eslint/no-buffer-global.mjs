/**
 * Rejects the global `Buffer` in code that Convex runs in its default
 * runtime, which has no `Buffer`. A file whose first statement is the
 * `"use node"` directive runs in Node and may use it. Elsewhere, import it:
 * `import { Buffer } from 'buffer'`.
 */
function usesNode(program) {
  const first = program.body[0]
  return (
    first?.type === 'ExpressionStatement' &&
    first.expression.type === 'Literal' &&
    first.expression.value === 'use node'
  )
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the global Buffer outside "use node" files in the Convex default runtime',
    },
    schema: [],
    messages: {
      global:
        'The Convex default runtime has no global Buffer. Add `import { Buffer } from \'buffer\'`, or start the file with "use node".',
    },
  },
  create(context) {
    return {
      'Program:exit'(program) {
        if (usesNode(program)) return
        const scope = context.sourceCode.getScope(program)
        for (const ref of scope.through) {
          if (ref.identifier.name !== 'Buffer') continue
          if (ref.isValueReference === false) continue
          context.report({ node: ref.identifier, messageId: 'global' })
        }
      },
    }
  },
}
