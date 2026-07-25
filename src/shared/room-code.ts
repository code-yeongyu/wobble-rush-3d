/**
 * Room code generation: four letters drawn from an unambiguous alphabet
 * (no I/O, easy to read out loud).
 */

import type { RoomCode } from "./types"
import { asRoomCode } from "./types"

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ" as const

export function generateRoomCode(random: () => number): RoomCode {
  let code = ""
  for (let i = 0; i < 4; i++) {
    const index = Math.min(
      Math.floor(random() * ROOM_CODE_ALPHABET.length),
      ROOM_CODE_ALPHABET.length - 1,
    )
    code += ROOM_CODE_ALPHABET.charAt(index)
  }
  return asRoomCode(code)
}
