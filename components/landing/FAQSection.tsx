'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef } from 'react'

export default function FAQSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const faqs = [
    {
      question: 'What is Quilltip and what problem does it solve?',
      answer:
        'Quilltip lets writers earn money directly from readers without ads, subscriptions, or gatekeepers taking large cuts. Anyone can publish articles for free, readers tip writers instantly with cryptocurrency, and writers keep 97.5% of every tip. All payments happen through Stellar blockchain smart contracts in 3-5 seconds with no intermediaries. Writers own their content permanently through NFTs (digital certificates of ownership), and readers never pay to access articles - tipping is always voluntary.',
    },
    {
      question: 'Do I need cryptocurrency to read articles?',
      answer:
        'No. Reading articles on Quilltip is completely free — no wallet, no account, no crypto needed. You only need a Stellar wallet if you want to tip writers for content you love. Setting up a wallet takes about 2 minutes, and we have a step-by-step guide to help you.',
    },
    {
      question: 'How does the tipping mechanism work?',
      answer:
        "Readers connect a Stellar wallet (Freighter, xBull, Albedo, or hot wallet), browse articles, and click \"Tip\" to send XLM directly to the writer's wallet. The transaction completes in 3-5 seconds through Soroban smart contracts. Writers receive funds instantly in their wallet - no withdrawal process or waiting period. Minimum tip is 0.026 XLM (approximately $0.01 USD) to ensure transaction fees don't exceed the tip value. There's no maximum limit.",
    },
    {
      question: "What's Quilltip's business model and revenue split?",
      answer:
        'Writers keep 97.5% of all tips. Quilltip takes 2.5% to cover infrastructure costs (hosting, Arweave storage fees, platform development). There are no subscription fees, hosting costs, or hidden charges for writers or readers.',
    },
    {
      question:
        'Is Quilltip live on mainnet or testnet? When can I use it with real money?',
      answer:
        "We're live on testnet for now and working towards our mainnet launch soon. You can test all features with free testnet XLM — no real money needed.",
    },
    {
      question: 'What does it cost to use Quilltip as a writer or reader?',
      answer:
        "Reading articles: completely free, no wallet needed. Tipping writers: pay only the Stellar network fee (0.05 XLM, less than $0.01) plus your chosen tip amount. Publishing articles: free, no hosting fees or subscriptions. Minting article NFTs: requires reaching a tip threshold (currently 10 XLM in total tips received), then pay minimal Stellar network fee for minting (approximately 0.05 XLM). Editing published articles: free, unlimited edits. When you update an article that's been minted as an NFT, the blockchain preserves the original version while displaying your latest edits to readers.",
    },
    {
      question:
        'What barriers prevent mainstream users from adopting Quilltip?',
      answer:
        "Currently requires a Stellar wallet to tip or publish, which can intimidate non-crypto users. We're addressing this by: (1) Supporting four popular wallets through Stellar Wallet Kit for maximum compatibility, (2) Providing wallet setup guides and testnet XLM for new users, (3) Making all articles readable without any wallet, (4) Planning USDC support so users can tip with stablecoins instead of volatile XLM. Future roadmap includes social login options and custodial wallet integration.",
    },
    {
      question:
        'How does Quilltip ensure my content survives long-term, even if the platform shuts down?',
      answer:
        'Two-layer permanence: (1) Arweave integration stores articles on decentralized, permanent storage that exists independently of Quilltip, with no recurring storage fees. (2) Article NFTs minted on Stellar blockchain create immutable proof of ownership and authorship. If Quilltip disappears, content persists on Arweave and ownership rights exist on Stellar.',
    },
    {
      question:
        'How does Quilltip handle content moderation while remaining decentralized?',
      answer:
        'Quilltip removes illegal content and violations of community guidelines from the platform interface. However, once Arweave integration launches, articles are stored on a decentralized network beyond our control, meaning censorship-resistant copies may persist. This balances platform safety with writer freedom: we curate the Quilltip experience while writers retain true ownership. Think of it like a library removing a book from shelves while the book itself still exists elsewhere.',
    },
  ]

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index)
  }

  return (
    <section id="faq" className="py-32 px-8 bg-white">
      <div className="container mx-auto max-w-6xl" ref={ref}>
        {/* Section Header */}
        <motion.h2
          className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-16 leading-[1.2] text-neutral-900"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          Frequently Asked Questions
        </motion.h2>

        {/* FAQ Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-6">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.5, delay: index * 0.08 }}
            >
              <button
                onClick={() => toggleFAQ(index)}
                className="w-full flex items-start gap-4 text-left py-2"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors duration-200 ${
                    openIndex === index
                      ? 'bg-brand-accent/20 text-brand-accent'
                      : 'bg-neutral-800 text-white'
                  }`}
                >
                  <ChevronDown className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-neutral-900 text-[15px] leading-relaxed pt-1">
                  {faq.question}
                </h3>
              </button>

              <AnimatePresence>
                {openIndex === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-12 pb-4 text-[14px] text-neutral-500 leading-relaxed">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
