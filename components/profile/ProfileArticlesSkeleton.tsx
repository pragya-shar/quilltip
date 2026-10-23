export function ProfileArticlesSkeleton() {
  return (
    <div className="reading-room profile-publications" aria-hidden>
      <div className="skeleton-row">
        {Array.from({ length: 3 }, (_, index) => (
          <i key={index} />
        ))}
      </div>
    </div>
  )
}
