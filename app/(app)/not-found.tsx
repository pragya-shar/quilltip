import { EmptyState } from '@/system/components/EmptyState'
import { Button } from '@/system/components/Button'

export default function AppNotFound() {
  return (
    <div className="qt-page">
      <EmptyState
        title="This page is not here"
        body="It may have moved, or the link may be wrong."
        action={
          <Button variant="primary" href="/">
            Go to reading
          </Button>
        }
      />
    </div>
  )
}
