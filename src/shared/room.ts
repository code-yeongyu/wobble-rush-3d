/**
 * Pure lobby/room state machine for Wobble Rush 3D: public API barrel.
 *
 * The types live in `room-types.ts`, the code generator in `room-code.ts`,
 * the message builders in `room-messages.ts` and the reducers in
 * `room-reducers.ts`.
 */

export { generateRoomCode } from "./room-code"
export { createRoom, reduceRoom } from "./room-reducers"
export type {
  RaceResult,
  RemoteRunnerState,
  RoomAction,
  RoomEffect,
  RoomPhase,
  RoomPlayer,
  RoomSnapshot,
  RoomState,
} from "./room-types"
export { ROOM_PHASES } from "./room-types"
