'use client'

export function DetailsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6 first:border-t-0 first:pt-0">
      {children}
    </section>
  )
}
