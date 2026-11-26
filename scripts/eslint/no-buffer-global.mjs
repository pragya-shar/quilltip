/**
 * Rejects the global `Buffer` in code that Convex runs in its default
 * runtime, which has no `Buffer`. A file whose first statement is the
 * `"use node"` directive runs in Node and may use it. Elsewhere, import it:
 * `import { Buffer } from 'buffer'`.
 *
 * Reported: a bare `Buffer`; `Buffer` read from `globalThis`, `global`,
 * `self` or `window` (dotted or as a string key); and `Buffer` destructured
 * from one of them. A `typeof` check is allowed.
 */
const GLOBAL_OBJECTS = ['globalThis', 'global', 'self', 'window']

function usesNode(program) {
  const first = program.body[0]
  return (
    first?.type === 'ExpressionStatement' &&
    first.expression.type === 'Literal' &&
    first.expression.value === 'use node'
  )
}

const isTypeof = (node) =>
  node.parent?.type === 'UnaryExpression' && node.parent.operator === 'typeof'

/** `x.Buffer` or `x['Buffer']`. */
function namesBuffer(member) {
  if (member.computed)
    return (
      (member.property.type === 'Literal' &&
        member.property.value === 'Buffer') ||
      (member.property.type === 'TemplateLiteral' &&
        member.property.expressions.length === 0 &&
        member.property.quasis[0]?.value.cooked === 'Buffer')
    )
  return (
    member.property.type === 'Identifier' && member.property.name === 'Buffer'
  )
}

/** `{ Buffer }`, `{ Buffer: B }` or `{ 'Buffer': B }`. */
function patternTakesBuffer(pattern) {
  return (
    pattern?.type === 'ObjectPattern' &&
    pattern.properties.some(
      (p) =>
        p.type === 'Property' &&
        ((!p.computed &&
          p.key.type === 'Identifier' &&
          p.key.name === 'Buffer') ||
          (p.key.type === 'Literal' && p.key.value === 'Buffer'))
    )
  )
}

/**
 * References to the global `name`: unresolved ones, and ones that resolve to
 * a configured global (both live in the global scope).
 */
function globalReferences(globalScope, name) {
  const configured = globalScope.set.get(name)
  return [
    ...globalScope.through.filter((r) => r.identifier.name === name),
    ...(configured && configured.defs.length === 0
      ? configured.references
      : []),
  ]
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
        const globalScope = context.sourceCode.scopeManager.globalScope
        if (!globalScope) return
        const report = (node) => context.report({ node, messageId: 'global' })

        for (const ref of globalReferences(globalScope, 'Buffer')) {
          if (ref.isValueReference === false) continue
          if (isTypeof(ref.identifier)) continue
          report(ref.identifier)
        }

        for (const name of GLOBAL_OBJECTS) {
          for (const ref of globalReferences(globalScope, name)) {
            const id = ref.identifier
            const parent = id.parent
            if (parent?.type === 'MemberExpression' && parent.object === id) {
              if (namesBuffer(parent) && !isTypeof(parent)) report(parent)
            } else if (
              parent?.type === 'VariableDeclarator' &&
              parent.init === id &&
              patternTakesBuffer(parent.id)
            ) {
              report(parent.id)
            } else if (
              parent?.type === 'AssignmentExpression' &&
              parent.right === id &&
              patternTakesBuffer(parent.left)
            ) {
              report(parent.left)
            }
          }
        }
      },
    }
  },
}
