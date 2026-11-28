/**
 * The icon vocabulary: one icon per meaning, following the design's map.
 * Surfaces use these names, not raw imports, so a meaning keeps one icon
 * everywhere. Add a meaning here (and its drawing in system/iconGlyphs.ts)
 * before using a new icon. Each is a name in the sprite at /icons.svg, so
 * an icon costs a few bytes of markup and no script.
 */
import type { IconName } from './iconGlyphs'

const icon = <N extends IconName>(name: N): N => name

export const TipIcon = icon('tip')
export const BalanceIcon = icon('balance')
export const ReadIcon = icon('home')
export const TodayIcon = icon('home')
export const ShelfIcon = icon('shelf')
export const KeepIcon = icon('keep')
export const KeptIcon = icon('kept')
export const WriteIcon = icon('write')
export const SearchIcon = icon('search')
export const YouIcon = icon('you')
export const AddIcon = icon('add')
export const WithdrawIcon = icon('withdraw')
export const ReceiveIcon = icon('receive')
export const ShareIcon = icon('share')
export const LinkIcon = icon('link')
export const SaveImageIcon = icon('save-image')
export const FaceIdIcon = icon('face-id')
export const FingerprintIcon = icon('fingerprint')
export const DoneIcon = icon('done')
export const FailIcon = icon('fail')
export const InfoIcon = icon('info')
export const PendingIcon = icon('pending')
export const OfflineIcon = icon('offline')
export const RetryIcon = icon('retry')
export const EditIcon = icon('edit')
export const ReadItIcon = icon('read-it')
export const OpenInBrowserIcon = icon('open-in-browser')
export const NotificationsIcon = icon('notifications')
export const SettingsIcon = icon('settings')
export const CloseIcon = icon('close')
export const TextStyleIcon = icon('text-style')
export const AddImageIcon = icon('add-image')
export const BackIcon = icon('back')
export const ForwardIcon = icon('forward')
export const ExpandIcon = icon('expand')
export const MoreIcon = icon('more')
export const AmountIcon = icon('amount')
export const GiftIcon = icon('gift')
export const SupporterIcon = icon('supporter')
export const PermanentIcon = icon('permanent')
