import { Button } from '../../../system/components/Button'

// Another page (or device) that sends a tip: the fixture's server keeps it,
// so the Pocket finds it there after a reload, once.
export function ElsewherePage({ onSend }: { onSend: () => void }) {
  return (
    <div className="qt-page">
      <Button variant="primary" onClick={onSend}>
        Send a 25¢ tip from here
      </Button>
    </div>
  )
}
