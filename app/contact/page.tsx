import type { Metadata } from 'next'
import { InfoPageLayout } from '@/components/layout/InfoPageLayout'
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
    <InfoPageLayout title="Contact" description={contactIntro}>
      <div className="space-y-10 text-foreground">
        {contactChannels.map((channel) => (
          <section key={channel.id} id={channel.id}>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              {channel.title}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground mb-3">
              {channel.description}
            </p>
            <a
              href={`mailto:${channel.email}`}
              className="text-sm text-primary hover:underline underline-offset-4"
            >
              {channel.email}
            </a>
          </section>
        ))}

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Important notes
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            {contactNotes.map((note, index) => (
              <p key={`note-${index}`}>{note}</p>
            ))}
          </div>
        </section>
      </div>
    </InfoPageLayout>
  )
}
