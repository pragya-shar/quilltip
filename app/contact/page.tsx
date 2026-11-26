import type { Metadata } from 'next'
import { ResourcePageLayout } from '@/components/layout/ResourcePageLayout'
import {
  contactChannels,
  contactIntro,
  contactNotes,
} from '@/lib/copy/contact-page'

export const metadata: Metadata = {
  title: 'Contact | Quilltip',
  description:
    'Contact Quilltip for legal, privacy, and security questions about the Stellar testnet platform.',
}

export default function ContactPage() {
  return (
    <ResourcePageLayout
      title="Contact"
      description={contactIntro}
      navigationTitle="On this page"
      links={[
        ...contactChannels.map((channel) => ({
          label: channel.title,
          href: `#${channel.id}`,
        })),
        { label: 'Important notes', href: '#notes' },
      ]}
    >
      {contactChannels.map((channel) => (
        <section key={channel.id} id={channel.id}>
          <h2>{channel.title}</h2>
          <p>{channel.description}</p>
          <a href={`mailto:${channel.email}`} className="resource-action">
            {channel.email}
          </a>
        </section>
      ))}

      <section id="notes">
        <h2>Important notes</h2>
        {contactNotes.map((note, index) => (
          <p key={`note-${index}`}>{note}</p>
        ))}
      </section>
    </ResourcePageLayout>
  )
}
