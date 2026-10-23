import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { FooterNav } from './FooterNav'

type SiteFooterProps = { variant?: 'landing' | 'default' }

export function SiteFooter(_props: SiteFooterProps) {
  return (
    <footer className="app-site-footer site-chrome">
      <div className="app-site-footer-inner">
        <div className="app-footer-brand">
          <LandingWordmark />
          <p>Your reading. Your support.</p>
        </div>
        <FooterNav />
        <p className="app-footer-copyright">
          © {new Date().getFullYear()} QuillTip
        </p>
      </div>
    </footer>
  )
}
