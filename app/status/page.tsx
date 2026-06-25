import type { Metadata } from 'next'
import { InfoPageLayout } from '@/components/layout/InfoPageLayout'
import {
  statusBanner,
  statusIntro,
  statusNotes,
  statusServices,
} from '@/lib/copy/status-page'

export const metadata: Metadata = {
  title: 'Platform Status | Quilltip',
  description:
    'Quilltip platform status on Stellar testnet. Beta launch scope and service availability.',
}

export default function StatusPage() {
  return (
    <InfoPageLayout title="Platform Status" description={statusIntro}>
      <div className="space-y-10 text-foreground">
        <div
          role="status"
          className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-warning-foreground"
        >
          {statusBanner}
        </div>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Services
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {statusServices.map((service) => (
              <li
                key={service.id}
                className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {service.name}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {service.detail}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium text-success-foreground">
                  {service.status}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Launch scope
          </h2>
          <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            {statusNotes.map((note, index) => (
              <p key={`status-note-${index}`}>{note}</p>
            ))}
          </div>
        </section>
      </div>
    </InfoPageLayout>
  )
}
