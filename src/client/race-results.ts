/** Personal-best bookkeeping and the solo results table. */

import type { RaceResult } from "../shared/room"
import type { PlayerId } from "../shared/types"
import { asPlayerId } from "../shared/types"
import { formatTime } from "./ui"

const BEST_TIME_KEY = "wobble-rush-3d:best"

export type BestOutcome = { readonly note: string; readonly isBest: boolean }

export function recordBest(raceMs: number, storage: Storage): BestOutcome {
  const stored = storage.getItem(BEST_TIME_KEY)
  const parsed = stored === null ? Number.NaN : Number.parseInt(stored, 10)
  const previous = Number.isNaN(parsed) ? null : parsed
  const isBest = previous === null || raceMs < previous
  if (isBest) storage.setItem(BEST_TIME_KEY, String(Math.round(raceMs)))

  if (previous === null) return { note: "First run recorded — now beat it.", isBest }
  if (isBest) return { note: `New personal best, ${formatTime(previous - raceMs)} faster!`, isBest }
  return { note: `Personal best stands at ${formatTime(previous)}.`, isBest }
}

export type FinisherRow = {
  readonly id: PlayerId
  readonly name: string
  readonly timeMs: number | null
}

/** Sorts finishers by time, with unfinished racers last. */
export function rankFinishers(rows: readonly FinisherRow[]): readonly RaceResult[] {
  return [...rows]
    .sort((a, b) => (a.timeMs ?? Number.POSITIVE_INFINITY) - (b.timeMs ?? Number.POSITIVE_INFINITY))
    .map((row, index) => ({ id: row.id, name: row.name, timeMs: row.timeMs, place: index + 1 }))
}

export const localFinisherId = (index: number): PlayerId => asPlayerId(`local-${index}`)

/** "3 / 6" — the runner's position among everyone else on the course. */
export function placementLabel(selfZ: number, otherZ: readonly number[]): string {
  if (otherZ.length === 0) return ""
  const ahead = otherZ.filter((z) => z > selfZ).length
  return `${ahead + 1} / ${otherZ.length + 1}`
}
