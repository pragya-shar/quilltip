import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_LAST_UPDATED,
  type LegalSection,
} from '@/lib/copy/legal-shared'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'

export const privacyLastUpdated = LEGAL_LAST_UPDATED

export const privacySections: LegalSection[] = [
  {
    id: 'introduction',
    title: '1. Introduction',
    paragraphs: [
      'This Privacy Policy explains how Quilltip ("Quilltip," "we," "us," or "our") collects, uses, and shares information when you use our website, applications, and related services (collectively, the "Service").',
      'By using the Service, you agree to the practices described here. Please also read our Terms of Service.',
    ],
  },
  {
    id: 'information-we-collect',
    title: '2. Information we collect',
    paragraphs: [
      'Account information: When you register, we collect information such as your email address, username, password (stored in hashed form through our authentication provider), and optional display name.',
      'Profile information: You may provide a bio, avatar, and Stellar wallet address associated with your profile for receiving tips or connecting a wallet.',
      'Content and activity: We store articles, drafts, highlights, tips, and related metadata you create or interact with on the Service.',
      'Wallet and blockchain data: When you connect a wallet or send tips, we process public blockchain addresses and transaction-related data needed to display balances, history, and withdrawals. On-chain transactions are public by nature.',
      TESTNET_PRACTICE_NOTE,
      'Technical data: We automatically collect information such as device type, browser, IP address, and usage logs to secure and operate the Service.',
    ],
  },
  {
    id: 'how-we-use',
    title: '3. How we use information',
    paragraphs: [
      'We use collected information to provide and improve the Service, authenticate users, publish and display content, process tips and withdrawals on testnet, prevent abuse, respond to support requests, and comply with legal obligations.',
      'We may use aggregated or de-identified data for analytics and product improvement.',
    ],
  },
  {
    id: 'sharing',
    title: '4. How we share information',
    paragraphs: [
      'Service providers: We use infrastructure providers (including hosting, database, and authentication services such as Convex) to operate the Service. They process data on our behalf under contractual safeguards.',
      'Blockchain networks: Tips, withdrawals, and NFT activity are recorded on the Stellar network and may be visible to anyone via public explorers.',
      'Decentralized storage: When enabled, article content may be stored on networks such as Arweave, where data may be permanent and publicly accessible.',
      'Analytics: We use Vercel Analytics to understand how the Service is used. Analytics data is generally aggregated and does not include article body text.',
      'Legal requirements: We may disclose information if required by law, court order, or to protect the rights, safety, and security of Quilltip, our users, or others.',
    ],
  },
  {
    id: 'cookies',
    title: '5. Cookies and session data',
    paragraphs: [
      'We use cookies and similar technologies to keep you signed in, remember preferences, and secure the Service. You can control cookies through your browser settings, but disabling them may limit functionality.',
    ],
  },
  {
    id: 'retention',
    title: '6. Data retention',
    paragraphs: [
      'We retain account and content data for as long as your account is active or as needed to provide the Service. We may retain certain records after account closure where required for legal, security, or backup purposes.',
      'Blockchain and decentralized storage data may persist indefinitely outside our control even after we delete copies from our systems.',
    ],
  },
  {
    id: 'your-rights',
    title: '7. Your choices and rights',
    paragraphs: [
      'You may update profile information from your account settings. You may request account deletion or data access by contacting us at the email below, subject to legal and operational limitations (including data already on public blockchains).',
      'Depending on where you live, you may have additional rights under applicable privacy laws (such as access, correction, or deletion). We will respond to valid requests in accordance with those laws.',
    ],
  },
  {
    id: 'security',
    title: '8. Security',
    paragraphs: [
      'We implement reasonable technical and organizational measures to protect information. No method of transmission or storage is completely secure; use strong passwords and protect your wallet keys.',
    ],
  },
  {
    id: 'children',
    title: "9. Children's privacy",
    paragraphs: [
      'The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13. If you believe we have done so, contact us and we will take appropriate steps to delete it.',
    ],
  },
  {
    id: 'international',
    title: '10. International users',
    paragraphs: [
      'If you access the Service from outside the United States, you understand that information may be processed in the United States or other countries where our providers operate, which may have different data protection rules than your jurisdiction.',
    ],
  },
  {
    id: 'changes',
    title: '11. Changes to this Policy',
    paragraphs: [
      'We may update this Privacy Policy from time to time. We will post the revised policy on this page and update the "Last updated" date. Material changes may also be communicated through the Service where appropriate.',
    ],
  },
  {
    id: 'contact',
    title: '12. Contact',
    paragraphs: [
      `Privacy questions or requests may be sent to ${LEGAL_CONTACT_EMAIL}.`,
    ],
  },
]
