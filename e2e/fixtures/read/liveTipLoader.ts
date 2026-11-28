// The read suite's stand-in for the tip bar's money-layer loader: the real
// module, after a delay or not at all, by `?tipbar=`:
// - `delay-<ms>`: loads after that many milliseconds;
// - `fail`, `fail-<ms>`: the load fails once (after that many milliseconds);
//   Try again then loads it.
import type { LiveTipModule } from '../../../components/read/liveTipLoader'

export type { LiveTipModule }

const setting = new URLSearchParams(location.search).get('tipbar') ?? ''
let failures = setting.startsWith('fail') ? 1 : 0

export const loadLiveTip = async (): Promise<LiveTipModule> => {
  const delay = /-(\d+)$/.exec(setting)
  if (delay && (failures > 0 || setting.startsWith('delay')))
    await new Promise((r) => setTimeout(r, Number(delay[1])))
  if (failures > 0) {
    failures -= 1
    throw new Error('The tip bar did not load (fixture)')
  }
  return import('../../../components/read/LiveTip')
}
