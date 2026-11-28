import { getSchema } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import { getReadingExtensions } from '@/lib/tiptap/readingExtensions'
import {
  READING_ATTR_CHECKS,
  READING_DERIVED_ATTRS,
  READING_MARKS,
  READING_NODES,
  type ReadingNodeName,
} from '@/lib/tiptap/sanitizeReadingDoc'

// The exported allowlist is the one definition: the reading schema has
// exactly its nodes and marks, each listed attribute has a value check, and
// the schema's other attributes are ones the sanitiser never copies.

/** Schema attributes that come with the Tiptap nodes and are never kept. */
const UNUSED_SCHEMA_ATTRS: Record<string, readonly string[]> = {
  orderedList: ['type'],
  codeBlock: ['language'],
  link: ['target', 'rel', 'class', 'title'],
}

const schema = getSchema(getReadingExtensions())
const attrsOf = (spec: { attrs?: object | null }) =>
  Object.keys(spec.attrs ?? {}).sort()

describe('the reading allowlist', () => {
  it('names the same nodes and marks as the reading schema', () => {
    expect(Object.keys(READING_NODES).sort()).toEqual(
      Object.keys(schema.nodes).sort()
    )
    expect(Object.keys(READING_MARKS).sort()).toEqual(
      Object.keys(schema.marks).sort()
    )
  })

  it('accounts for every schema attribute', () => {
    for (const [name, rule] of Object.entries(READING_NODES))
      expect(attrsOf(schema.nodes[name]!.spec), name).toEqual(
        [
          ...rule.attrs,
          ...(READING_DERIVED_ATTRS[name as ReadingNodeName] ?? []),
          ...(UNUSED_SCHEMA_ATTRS[name] ?? []),
        ].sort()
      )
    for (const [name, rule] of Object.entries(READING_MARKS))
      expect(attrsOf(schema.marks[name]!.spec), name).toEqual(
        [...rule.attrs, ...(UNUSED_SCHEMA_ATTRS[name] ?? [])].sort()
      )
  })

  it('checks every listed attribute', () => {
    const rules = { ...READING_NODES, ...READING_MARKS }
    for (const [name, rule] of Object.entries(rules))
      for (const attr of rule.attrs)
        expect(
          READING_ATTR_CHECKS[name as keyof typeof READING_ATTR_CHECKS]?.[attr],
          `${name}.${attr}`
        ).toBeTypeOf('function')
  })

  it('lists only nodes as children', () => {
    for (const [name, rule] of Object.entries(READING_NODES))
      for (const child of rule.children)
        expect(Object.keys(READING_NODES), `${name} > ${child}`).toContain(
          child
        )
  })
})
