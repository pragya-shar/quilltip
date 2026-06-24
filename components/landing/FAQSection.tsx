'use client'

import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, useInView } from 'motion/react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { cn } from '@/lib/utils'
import { LANDING_FAQS } from '@/lib/copy/landing-sections'

const faqTriggerFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

export default function FAQSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="py-32 px-8 bg-background"
    >
      <div className="container mx-auto max-w-6xl" ref={ref}>
        <motion.h2
          id="faq-heading"
          className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-16 leading-[1.2] text-foreground"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          Frequently Asked Questions
        </motion.h2>

        <Accordion
          type="single"
          collapsible
          defaultValue="faq-0"
          data-testid="faq-accordion"
          className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6"
        >
          {LANDING_FAQS.map((faq, index) => (
            <motion.div
              key={faq.question}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
            >
              <AccordionItem value={`faq-${index}`} className="border-none">
                <AccordionTrigger
                  showChevron={false}
                  className={cn(
                    'group w-full flex justify-start items-start gap-4 py-2 hover:no-underline',
                    faqTriggerFocusClass
                  )}
                >
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors duration-200',
                      'bg-muted text-foreground border border-border',
                      'group-data-[state=open]:bg-brand/15 group-data-[state=open]:text-brand group-data-[state=open]:border-transparent'
                    )}
                  >
                    <ChevronDown
                      className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="flex-1 min-w-0 font-semibold text-foreground text-[15px] leading-relaxed pt-1 text-left">
                    {faq.question}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="ml-12 text-[14px] text-muted-foreground leading-relaxed">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            </motion.div>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
