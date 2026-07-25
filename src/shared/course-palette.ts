/**
 * Colour constants for Wobble Rush 3D: the course palette and the runner body
 * colours, cycled by player index.
 */

export const PALETTE = {
  deckAqua: "#2FB3E8",
  deckSun: "#FFC02E",
  deckRest: "#5FD44A",
  deckBridge: "#FF8A1F",
  deckRamp: "#FF5FA8",
  hazard: "#F5273F",
  hazardStripe: "#FFD400",
  bumper: "#F857C4",
  mover: "#8B62FF",
  finish: "#FFD62E",
  ink: "#2A2440",
  skyTop: "#7FA8FF",
  skyHorizon: "#FFE0C0",
  cloud: "#FFFFFF",
} as const

/** Runner body colours, cycled by player index. */
export const RUNNER_COLORS = [
  "#FF7A5C",
  "#5CC9F5",
  "#8FE870",
  "#FFD25E",
  "#C98BFF",
  "#FF7AD9",
  "#5CE8C8",
  "#FFA94D",
] as const
