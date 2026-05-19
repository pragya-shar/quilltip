import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  type LegalSection,
} from '@/lib/copy/legal-shared'
import {
  MAINNET_COMING_NOTE,
  TESTNET_PRACTICE_NOTE,
} from '@/lib/copy/network-status'

export const termsLastUpdated = LEGAL_LAST_UPDATED

export const termsSections: LegalSection[] = [
  {
    id: 'acceptance',
    title: '1. Acceptance of these Terms',
    paragraphs: [
      'These Terms of Service ("Terms") govern your access to and use of Quilltip ("Quilltip," "we," "us," or "our"), including our website, applications, and related services (collectively, the "Service").',
      'By creating an account, signing in, publishing content, connecting a wallet, or otherwise using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.',
    ],
  },
  {
    id: 'service-description',
    title: '2. The Service',
    paragraphs: [
      'Quilltip is a publishing platform where writers share articles and readers may send voluntary tips. The Service is designed to help writers receive direct support from readers using blockchain-based payments.',
      TESTNET_PRACTICE_NOTE,
      MAINNET_COMING_NOTE,
    ],
  },
  {
    id: 'accounts',
    title: '3. Accounts and eligibility',
    paragraphs: [
      'You must provide accurate registration information and keep your account credentials secure. You are responsible for all activity under your account.',
      'You must be at least 13 years old to use the Service. If you are under 18, you may use the Service only with permission from a parent or legal guardian who accepts these Terms on your behalf.',
      'We may suspend or terminate accounts that violate these Terms, applicable law, or our community standards.',
    ],
  },
  {
    id: 'user-content',
    title: '4. Your content',
    paragraphs: [
      'You retain ownership of content you publish on Quilltip, subject to the licenses you grant us to operate the Service (for example, to display, store, and distribute your articles to readers).',
      'You represent that you have the rights to publish your content and that it does not infringe others\' intellectual property, privacy, or other rights.',
      'You grant Quilltip a non-exclusive, worldwide license to host, reproduce, display, and promote your content solely to provide and improve the Service.',
    ],
  },
  {
    id: 'tipping',
    title: '5. Tips, fees, and payments',
    paragraphs: [
      'Tips on Quilltip are voluntary. Readers choose whether and how much to tip. Writers receive 97.5% of each tip; Quilltip retains 2.5% to support platform operations.',
      'While the Service operates on Stellar testnet, tips use test XLM only and have no real-world monetary value. You should not treat testnet balances as cash or savings.',
      'Blockchain transactions are processed on the Stellar network. Network fees, confirmation times, and wallet compatibility are outside our direct control. You are responsible for verifying wallet addresses before sending tips or withdrawals.',
      'We do not guarantee uninterrupted tipping, withdrawal, or wallet connectivity. Smart contract and network behavior may change as we iterate on the product.',
    ],
  },
  {
    id: 'storage-nfts',
    title: '6. Permanent storage and NFTs',
    paragraphs: [
      'Quilltip may store or reference article content on decentralized networks such as Arweave so that published work can persist independently of our servers. Once content is stored on a decentralized network, copies may remain accessible even if we remove content from the Quilltip interface.',
      'Article NFTs on Stellar may serve as proof of ownership or authorship. Minting, transfer, and on-chain metadata are subject to network rules and your wallet provider\'s terms.',
    ],
  },
  {
    id: 'conduct',
    title: '7. Acceptable use and moderation',
    paragraphs: [
      'You may not use the Service for illegal activity, harassment, fraud, malware distribution, spam, or impersonation. You may not attempt to disrupt, scrape, or reverse engineer the Service without permission.',
      'We may remove or restrict content that violates law, these Terms, or community guidelines. As described in our product documentation, we may remove violating material from the Quilltip interface while decentralized copies may still exist elsewhere.',
    ],
  },
  {
    id: 'disclaimers',
    title: '8. Disclaimers',
    paragraphs: [
      'THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.',
      'We do not warrant that the Service will be error-free, secure, or available at all times. Blockchain and third-party wallet services may fail, delay, or change without notice.',
      'Nothing in these Terms constitutes financial, legal, or investment advice.',
    ],
  },
  {
    id: 'liability',
    title: '9. Limitation of liability',
    paragraphs: [
      'To the fullest extent permitted by law, Quilltip and its operators will not be liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, data, goodwill, or digital assets, arising from your use of the Service.',
      'Our total liability for any claim relating to the Service is limited to the greater of (a) amounts you paid to Quilltip in the twelve months before the claim or (b) fifty U.S. dollars (USD $50).',
      'Some jurisdictions do not allow certain limitations; in those cases, our liability is limited to the maximum extent permitted by law.',
    ],
  },
  {
    id: 'changes',
    title: '10. Changes to these Terms',
    paragraphs: [
      'We may update these Terms from time to time. When we make material changes, we will post the updated Terms on this page and update the "Last updated" date. Continued use of the Service after changes become effective constitutes acceptance of the revised Terms.',
    ],
  },
  {
    id: 'contact',
    title: '11. Contact',
    paragraphs: [
      `Questions about these Terms may be sent to ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
]
