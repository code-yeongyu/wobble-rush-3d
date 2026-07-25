import { describe, expect, test } from "bun:test"
import type { ClientMessage, ServerMessage } from "../src/shared/protocol"
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
  PROTOCOL_VERSION,
  ProtocolError,
} from "../src/shared/protocol"
import type { RaceResult, RemoteRunnerState, RoomSnapshot } from "../src/shared/room"
import { asPlayerId, asRoomCode } from "../src/shared/types"

const SEED = 123_456_789

const remoteAlpha: RemoteRunnerState = {
  id: asPlayerId("p-1"),
  p: [1.5, -2.25, 3],
  v: [0, 9.4, -8.2],
  yaw: 1.5708,
  st: "air",
  cp: 2,
}

const snapshot: RoomSnapshot = {
  code: asRoomCode("WXYZ"),
  phase: "racing",
  seed: SEED,
  phaseEndsAtMs: null,
  players: [
    {
      id: asPlayerId("p-1"),
      name: "WobbleKing",
      colorIndex: 3,
      ready: true,
      finishedMs: null,
      lastSeenMs: 1000,
      state: remoteAlpha,
    },
    {
      id: asPlayerId("p-2"),
      name: "SecondPlace",
      colorIndex: 1,
      ready: false,
      finishedMs: 61_234,
      lastSeenMs: 2000,
      state: null,
    },
  ],
}

const results: readonly RaceResult[] = [
  { id: asPlayerId("p-2"), name: "SecondPlace", timeMs: 61_234, place: 1 },
  { id: asPlayerId("p-1"), name: "WobbleKing", timeMs: null, place: 2 },
]

const clientMessages: readonly ClientMessage[] = [
  { type: "join", name: "WobbleKing", mode: "solo", colorIndex: 3 },
  { type: "join", name: "パーティー", mode: "party", colorIndex: 0 },
  { type: "ready", ready: true },
  { type: "ready", ready: false },
  { type: "state", p: [1.5, -2.25, 3], v: [0, 9.4, -8.2], yaw: 1.5708, st: "air", cp: 2 },
  { type: "finish", timeMs: 61_234 },
  { type: "restart" },
  { type: "leave" },
]

const serverMessages: readonly ServerMessage[] = [
  { type: "welcome", you: asPlayerId("p-1"), room: asRoomCode("WXYZ"), seed: SEED, snapshot },
  { type: "roster", snapshot },
  { type: "phase", phase: "countdown", serverNowMs: 5000, phaseEndsAtMs: 8000, seed: SEED },
  { type: "phase", phase: "racing", serverNowMs: 8000, phaseEndsAtMs: null, seed: SEED },
  { type: "states", serverNowMs: 8100, players: [remoteAlpha] },
  { type: "results", results },
  { type: "error", code: "room_full", message: "Room is full (8 players)" },
]

function expectProtocolError(fn: () => unknown): ProtocolError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ProtocolError) return e
    throw e
  }
  throw new Error("expected a ProtocolError to be thrown")
}

describe("protocol version", () => {
  test("is pinned to 1", () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })
})

describe("client message round-trips", () => {
  for (const message of clientMessages) {
    test(`${message.type} survives encode → decode unchanged`, () => {
      expect(decodeClientMessage(encodeClientMessage(message))).toEqual(message)
    })
  }

  test("decodes from an ArrayBuffer", () => {
    const message = clientMessages[0]
    if (message === undefined) throw new Error("fixture missing")
    const bytes = new TextEncoder().encode(encodeClientMessage(message))
    expect(decodeClientMessage(bytes.buffer)).toEqual(message)
  })
})

describe("server message round-trips", () => {
  for (const message of serverMessages) {
    test(`${message.type} survives encode → decode unchanged`, () => {
      expect(decodeServerMessage(encodeServerMessage(message))).toEqual(message)
    })
  }

  test("decodes from an ArrayBuffer", () => {
    const message = serverMessages[6]
    if (message === undefined) throw new Error("fixture missing")
    const bytes = new TextEncoder().encode(encodeServerMessage(message))
    expect(decodeServerMessage(bytes.buffer)).toEqual(message)
  })
})

describe("client decode rejects garbage", () => {
  test("malformed JSON throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeClientMessage("{not json"))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("unknown type throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeClientMessage('{"type":"explode"}'))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("missing field throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeClientMessage('{"type":"ready"}'))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("wrong-typed field throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeClientMessage('{"type":"ready","ready":"yes"}'))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("NaN literal in a position throws ProtocolError", () => {
    const raw = '{"type":"state","p":[NaN,0,0],"v":[0,0,0],"yaw":0,"st":"run","cp":0}'
    const err = expectProtocolError(() => decodeClientMessage(raw))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("Infinity (1e999) in a position throws ProtocolError", () => {
    const raw = '{"type":"state","p":[1e999,0,0],"v":[0,0,0],"yaw":0,"st":"run","cp":0}'
    const err = expectProtocolError(() => decodeClientMessage(raw))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("wrong runner state throws ProtocolError", () => {
    const raw = '{"type":"state","p":[0,0,0],"v":[0,0,0],"yaw":0,"st":"flying","cp":0}'
    const err = expectProtocolError(() => decodeClientMessage(raw))
    expect(err.issues.length).toBeGreaterThan(0)
  })
})

describe("server decode rejects garbage", () => {
  test("malformed JSON throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeServerMessage("[1,2"))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("unknown type throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeServerMessage('{"type":"hack"}'))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("missing nested field throws ProtocolError with issues", () => {
    const err = expectProtocolError(() => decodeServerMessage('{"type":"roster","snapshot":{}}'))
    expect(err.issues.length).toBeGreaterThan(0)
  })

  test("non-finite yaw in a states payload throws ProtocolError", () => {
    const raw =
      '{"type":"states","serverNowMs":1,"players":[{"id":"p-1","p":[0,0,0],"v":[0,0,0],"yaw":1e999,"st":"run","cp":0}]}'
    const err = expectProtocolError(() => decodeServerMessage(raw))
    expect(err.issues.length).toBeGreaterThan(0)
  })
})
