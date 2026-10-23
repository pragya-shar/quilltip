import Link from 'next/link'
import { LandingWordmark } from './LandingWordmark'

export function LandingFooter() {
  return (
    <footer className="page-footer landing-footer">
      <div className="footer-brand">
        <LandingWordmark />
      </div>
      <nav aria-label="Explore QuillTip">
        <h2>Find your way</h2>
        <Link href="/articles">Read</Link>
        <Link href="/write">Write</Link>
        <a href="#try-it">How it works</a>
      </nav>
      <nav aria-label="Help and policies">
        <h2>Help &amp; information</h2>
        <Link
          className="text-action"
          href="/wallet/practice?returnTo=%2F%23try-it"
        >
          Wallet &amp; Stellar demo
        </Link>
        <a href="#questions">Questions</a>
        <Link href="/support">Support</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
    </footer>
  )
}
