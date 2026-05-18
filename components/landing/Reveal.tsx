'use client'

import { motion, type HTMLMotionProps } from 'motion/react'

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
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: '0px 0px -10% 0px' }}
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
