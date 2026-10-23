const functionTypes = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
])

function containsJsx(node, visitorKeys, root = true) {
  if (!node) return false
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true
  if (!root && functionTypes.has(node.type)) return false
  return (visitorKeys[node.type] ?? []).some((key) => {
    const children = Array.isArray(node[key]) ? node[key] : [node[key]]
    return children.some((child) => containsJsx(child, visitorKeys, false))
  })
}

function componentFunction(node) {
  if (!node) return null
  if (functionTypes.has(node.type)) return node
  if (node.type !== 'CallExpression') return null
  const callee = node.callee
  const name =
    callee.type === 'Identifier'
      ? callee.name
      : callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'React' &&
          !callee.computed
        ? callee.property.name
        : null
  if (name !== 'memo' && name !== 'forwardRef') return null
  return componentFunction(node.arguments[0])
}

export default {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      multiple:
        'Define one component per file, including private helpers. Move {{name}} to its own file. See docs/component-organization.md.',
    },
  },
  create(context) {
    const { visitorKeys } = context.sourceCode
    return {
      Program(program) {
        const components = []
        for (const statement of program.body) {
          const isDefault = statement.type === 'ExportDefaultDeclaration'
          const node =
            statement.type === 'ExportNamedDeclaration' ||
            statement.type === 'ExportDefaultDeclaration'
              ? statement.declaration
              : statement
          if (!node) continue
          if (
            functionTypes.has(node.type) &&
            (isDefault || /^[A-Z]/.test(node.id?.name ?? '')) &&
            containsJsx(node.body, visitorKeys)
          ) {
            components.push({ node, name: node.id?.name ?? 'default' })
          } else if (node.type === 'VariableDeclaration') {
            for (const declaration of node.declarations) {
              if (declaration.id.type !== 'Identifier') continue
              const fn = componentFunction(declaration.init)
              if (
                /^[A-Z]/.test(declaration.id.name) &&
                fn &&
                containsJsx(fn.body, visitorKeys)
              ) {
                components.push({
                  node: declaration,
                  name: declaration.id.name,
                })
              }
            }
          } else if (
            node.type === 'ClassDeclaration' &&
            /^[A-Z]/.test(node.id?.name ?? '') &&
            (node.superClass?.name === 'Component' ||
              node.superClass?.name === 'PureComponent' ||
              (node.superClass?.type === 'MemberExpression' &&
                node.superClass.object.name === 'React' &&
                ['Component', 'PureComponent'].includes(
                  node.superClass.property.name
                )))
          ) {
            components.push({ node, name: node.id.name })
          }
        }
        for (const { node, name } of components.slice(1)) {
          context.report({ node, messageId: 'multiple', data: { name } })
        }
      },
    }
  },
}
