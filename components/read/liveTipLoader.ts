import type { ComponentType } from 'react'
import type { LiveTipProps } from './LiveTip'

export type LiveTipModule = { LiveTip: ComponentType<LiveTipProps> }

/**
 * The tip bar's money layer (`LiveTip`), loaded after the page so no
 * payments code beyond its store is in the article's first load. The read
 * suite replaces this module to delay or fail the load.
 */
export const loadLiveTip = (): Promise<LiveTipModule> => import('./LiveTip')
