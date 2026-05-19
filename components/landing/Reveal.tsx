'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react'

export const LANDING_REVEAL_EVENT = 'landing:reveal-section'

export function revealSection(hash: string) {
  const id = hash.startsWith('#') ? hash.slice(1) : hash
  const target = document.getElementById(id)
  if (!target) return

  const section = target.closest('section') ?? target
  section.setAttribute('data-landing-revealed', 'true')
  section.dispatchEvent(
    new CustomEvent(LANDING_REVEAL_EVENT, { bubbles: true })
  )
}

type RevealProps = HTMLMotionProps<'div'> & {
  delay?: number
}

export function Reveal({
  children,
  className,
  delay = 0,
  transition,
  ...props
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const [forceVisible, setForceVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const section = el.closest('section')
    if (!section) return

    const reveal = () => setForceVisible(true)

    if (section.getAttribute('data-landing-revealed') === 'true') {
      reveal()
    }

    section.addEventListener(LANDING_REVEAL_EVENT, reveal)
    return () => section.removeEventListener(LANDING_REVEAL_EVENT, reveal)
  }, [])

  const isVisible = prefersReducedMotion === true || forceVisible

  return (
    <motion.div
      ref={ref}
      data-reveal
      className={className}
      initial={isVisible ? false : { opacity: 0, y: 24 }}
      animate={isVisible ? { opacity: 1, y: 0 } : undefined}
      whileInView={isVisible ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.05 }}
      transition={{
        duration: 0.6,
        delay,
        ease: 'easeOut',
        ...transition,
      }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
