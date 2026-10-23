type SectionFailureProps = {
  title: string
  description: string
  onRetry: () => void
}

export function SectionFailure({
  title,
  description,
  onRetry,
}: SectionFailureProps) {
  return (
    <section className="failure-section" role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="failure-actions">
        <button type="button" className="failure-action" onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  )
}
