'use client'

export function GuideTabIntro({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {children}
      </p>
    </div>
  )
}
