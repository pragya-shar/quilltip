import { describe, expect, it, vi } from 'vitest'
import {
  PASSAGE_COPY,
  passageActions,
  type PassageMutations,
  type PassageNotice,
} from '@/hooks/passages/passageActions'

const passage = {
  text: 'It was green cloth.',
  startOffset: 30,
  endOffset: 49,
  startContainerPath: 'text.30',
  endContainerPath: 'text.49',
}

function setup(over: Partial<PassageMutations<string>> = {}) {
  const notices: PassageNotice[] = []
  const m: PassageMutations<string> = {
    create: vi.fn(async () => 'h1'),
    remove: vi.fn(async () => ({ success: true })),
    restore: vi.fn(async () => 'h1'),
    appreciate: vi.fn(async () => null),
    update: vi.fn(async () => 'h1'),
    ...over,
  }
  return { m, notices, actions: passageActions(m, (n) => notices.push(n)) }
}

describe('passage actions', () => {
  it('keeps a line privately and says so once', async () => {
    const { m, notices, actions } = setup()
    expect(await actions.keep('a1', passage)).toBe('h1')
    expect(m.create).toHaveBeenCalledWith({
      articleId: 'a1',
      ...passage,
      note: undefined,
      isPublic: false,
    })
    expect(notices).toEqual([{ title: PASSAGE_COPY.kept, tone: 'done' }])
  })

  it('a failed keep says it did not save and returns null', async () => {
    const { notices, actions } = setup({
      create: async () => {
        throw new Error('offline')
      },
    })
    expect(await actions.keep('a1', passage)).toBeNull()
    expect(notices).toEqual([{ title: PASSAGE_COPY.failed, tone: 'failure' }])
  })

  it('removing offers an Undo that restores the line', async () => {
    const { m, notices, actions } = setup()
    expect(await actions.remove('h1')).toBe(true)
    const [notice] = notices
    expect(notice?.action?.label).toBe(PASSAGE_COPY.undo)
    notice!.action!.onAction()
    await vi.waitFor(() => expect(m.restore).toHaveBeenCalledWith({ id: 'h1' }))
    await vi.waitFor(() =>
      expect(notices.at(-1)).toEqual({
        title: PASSAGE_COPY.restored,
        tone: 'done',
      })
    )
  })

  it('a failed restore offers to try again', async () => {
    let calls = 0
    const { notices, actions } = setup({
      restore: async () => {
        calls++
        if (calls === 1) throw new Error('no')
        return 'h1'
      },
    })
    expect(await actions.restore('h1')).toBe(false)
    expect(notices.at(-1)?.title).toBe(PASSAGE_COPY.restoreFailed)
    notices.at(-1)!.action!.onAction()
    await vi.waitFor(() => expect(calls).toBe(2))
  })

  it('appreciates and saves a trimmed note', async () => {
    const { m, actions } = setup()
    expect(await actions.appreciate('h1', true)).toBe(true)
    expect(m.appreciate).toHaveBeenCalledWith({ id: 'h1', appreciated: true })
    expect(await actions.saveNote('h1', '  a note  ')).toBe(true)
    expect(m.update).toHaveBeenCalledWith({ id: 'h1', note: 'a note' })
  })

  it('quiet: says failures only', async () => {
    const notices: PassageNotice[] = []
    const actions = passageActions(
      {
        create: async () => 'h1',
        remove: async () => ({ success: true }),
        restore: async () => 'h1',
        appreciate: async () => {
          throw new Error('no')
        },
        update: async () => 'h1',
      },
      (n) => notices.push(n),
      { quiet: true }
    )
    expect(await actions.keep('a1', passage)).toBe('h1')
    expect(await actions.remove('h1')).toBe(true)
    expect(notices).toEqual([])
    expect(await actions.appreciate('h1', true)).toBe(false)
    expect(notices).toEqual([{ title: PASSAGE_COPY.failed, tone: 'failure' }])
  })
})
