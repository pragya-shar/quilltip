/** @vitest-environment jsdom */
import type { HTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FAQSection from '@/components/landing/FAQSection'

vi.mock('motion/react', () => ({
  motion: {
    h2: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h2 {...props}>{children}</h2>
    ),
    div: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
  },
  useInView: () => true,
}))

describe('FAQSection accordion accessibility', () => {
  const firstQuestion = 'What is Quilltip and what problem does it solve?'
  const secondQuestion = 'Do I need cryptocurrency to read articles?'

  function getTrigger(name: string) {
    return screen.getByRole('button', { name })
  }

  it('exposes expanded state on the default open item', () => {
    render(<FAQSection />)

    const first = getTrigger(firstQuestion)
    expect(first).toHaveAttribute('aria-expanded', 'true')
    expect(first).toHaveAttribute('aria-controls')

    const controlsId = first.getAttribute('aria-controls')
    expect(controlsId).toBeTruthy()
    const panel = document.getElementById(controlsId!)
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('aria-labelledby', first.id)
  })

  it('collapses the previous item when another is opened', async () => {
    const user = userEvent.setup()
    render(<FAQSection />)

    const first = getTrigger(firstQuestion)
    const second = getTrigger(secondQuestion)

    expect(second).toHaveAttribute('aria-expanded', 'false')

    await user.click(second)

    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves focus to the next question with ArrowDown', async () => {
    const user = userEvent.setup()
    render(<FAQSection />)

    const first = getTrigger(firstQuestion)
    const second = getTrigger(secondQuestion)

    first.focus()
    await user.keyboard('{ArrowDown}')

    expect(second).toHaveFocus()
  })

  it('labels the FAQ section for assistive tech', () => {
    render(<FAQSection />)

    const section = document.getElementById('faq')
    expect(section).toHaveAttribute('aria-labelledby', 'faq-heading')
    expect(document.getElementById('faq-heading')).toHaveTextContent(
      'Frequently Asked Questions'
    )
  })

  it('keeps FAQ items in left-started desktop columns', () => {
    render(<FAQSection />)

    const accordion = screen.getByTestId('faq-accordion')
    expect(accordion).toHaveClass('grid')
    expect(accordion).toHaveClass('grid-cols-1')
    expect(accordion).toHaveClass('md:grid-cols-2')

    expect(getTrigger(firstQuestion)).toHaveClass('justify-start')
  })
})
