'use client'

import { ActivityRow } from '../components/ActivityRow'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { ListRow } from '../components/ListRow'
import { MoneyFigure } from '../components/MoneyFigure'
import { AddIcon, WithdrawIcon } from '../icons'
import { GallerySection } from './GallerySection'
import { Glyph } from './Glyph'
import { Specimen } from './Specimen'
import { money, worst } from './samples'
import { showToast } from '../toast'

/** Rows, activity and avatars, with worst-case text. */
export function ListsSection() {
  return (
    <GallerySection id="lists" title="Rows, activity and avatars">
      <Specimen name="Activity" wide>
        <div>
          <ActivityRow
            lead={<Avatar name="Noor Haddad" decorative />}
            name="Noor Haddad"
            about="The last keeper of the Ras al-Hadd light"
            amount={money.tipRow}
            direction="out"
            status="done"
            time="Just now"
            isNew
            href="/system#lists"
          />
          <ActivityRow
            lead={<Avatar name="Tomás Reyes" decorative />}
            name="Tomás Reyes"
            about={worst.passage}
            amount={money.tipRow}
            direction="out"
            status="pending"
            time="9:38"
            onPress={() => showToast({ title: 'Receipt opens here' })}
          />
          <ActivityRow
            lead={<Glyph icon={AddIcon} />}
            name="Added money"
            about="From your wallet"
            amount={money.added}
            direction="in"
            status="done"
            time="Today"
          />
          <ActivityRow
            lead={<Avatar name="Jun Park" decorative />}
            name="Jun Park"
            about="Against the infinite scroll"
            amount={money.tipRow}
            direction="out"
            status="failed"
            time="Yesterday"
          />
          <ActivityRow
            lead={<Avatar name="A reader" decorative />}
            name="A reader"
            label="A reader, plus 98 cents, open receipt"
            onPress={() => showToast({ title: 'Receipt opens here' })}
            detail="from a $1 tip"
            about="When she died we read it aloud"
            amount={money.received}
            direction="in"
            status="done"
            time="9:12"
            action={<Button variant="quiet">Thank</Button>}
          />
          <ActivityRow
            lead={<Glyph icon={WithdrawIcon} />}
            name={worst.longName}
            about={worst.unbroken}
            amount={money.large}
            direction="out"
            status="done"
            time="Mon"
          />
        </div>
      </Specimen>
      <Specimen name="Avatar sources">
        <div className="qt-gallery__row" data-avatar-sources="">
          <Avatar name="Same Site" src="/images/quilltip-logo.png" />
          <Avatar name="Other Host" src="https://images.example.org/me.png" />
          <Avatar name="No Image" />
        </div>
      </Specimen>
      <Specimen name="List rows">
        <div>
          <ListRow
            title="One tap sends"
            trailing={<span className="qt-gallery__value">$1</span>}
          />
          <ListRow
            title="Pay with"
            subtitle="Everything shows in dollars"
            href="/system#lists"
          />
          <ListRow
            lead={<Avatar name={worst.longName} decorative />}
            title={worst.longName}
            subtitle={worst.passage}
            subtitleFace="serif"
            trailing={<MoneyFigure value={money.earnings} size="s" tone="in" />}
            trailingMeta="140 tips"
          />
          <ListRow title="Sign out" onPress={() => {}} />
        </div>
      </Specimen>
      <Specimen name="Avatars">
        <div className="qt-gallery__row">
          <Avatar name="Tomás Reyes" size={24} />
          <Avatar name="Noor Haddad" size={30} />
          <Avatar name="Ama Mensah" />
          <Avatar name={worst.rtlName} size={56} />
          <Avatar name="Jun Park" size={56} />
          <Avatar name="Kim Moreau" size={42} />
        </div>
      </Specimen>
    </GallerySection>
  )
}
