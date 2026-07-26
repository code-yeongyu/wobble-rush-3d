/** Protocol-level QA drill (run against `wrangler dev --port 8788`): while tripped, lobby sockets cannot start a race (R5) and post-race rooms drain (R4). */
type Frame = { type: string; phase?: string; code?: string }
type Sock = {
  ws: WebSocket
  frames: Frame[]
  closed: number | null
  name: string
  /** Event-driven waiters, notified from onmessage/onclose - never polled. */
  waiters: Array<() => void>
}

const BASE = "ws://localhost:8788/ws"
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const code = () =>
  Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join("")
const ROOM_A = code()
const ROOM_B = code()
const sockets: Sock[] = []

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Parses a raw socket payload through the frame shape - no casts. */
function parseFrame(data: unknown): Frame {
  const value: unknown = JSON.parse(String(data))
  if (!isObject(value) || typeof value.type !== "string") {
    throw new Error(`malformed frame: ${String(data)}`)
  }
  const frame: Frame = { type: value.type }
  if (typeof value.phase === "string") frame.phase = value.phase
  if (typeof value.code === "string") frame.code = value.code
  return frame
}

function connect(room: string, name: string): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}/${room}`)
    const s: Sock = { ws, frames: [], closed: null, name, waiters: [] }
    sockets.push(s)
    ws.onopen = () => resolve(s)
    ws.onerror = () => reject(new Error(`${name}: connect failed`))
    ws.onclose = (e) => {
      s.closed = e.code
      for (const notify of s.waiters) notify()
    }
    ws.onmessage = (e) => {
      s.frames.push(parseFrame(e.data))
      for (const notify of s.waiters) notify()
    }
  })
}
const send = (s: Sock, m: unknown) => s.ws.send(JSON.stringify(m))
const has = (s: Sock, f: (fr: Frame) => boolean) => s.frames.some(f)

/** Await a condition over one socket's received events: checked on every message/close, bounded by a timeout - no polling. */
function waitOn(sock: Sock, cond: (s: Sock) => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cond(sock)) {
      resolve()
      return
    }
    const timer = setTimeout(() => reject(new Error(`timeout waiting for: ${what}`)), ms)
    sock.waiters.push(() => {
      if (cond(sock)) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}
const settled = (socks: Sock[], cond: (s: Sock) => boolean, ms: number, what: string) =>
  Promise.all(socks.map((s) => waitOn(s, cond, ms, `${what} (${s.name})`)))
const pausedErr = (fr: Frame) => fr.type === "error" && fr.code === "service_paused"

// Room A: lobby, joined, NOT ready
const a1 = await connect(ROOM_A, "a1")
const a2 = await connect(ROOM_A, "a2")
send(a1, { type: "join", name: "LobbyOne", mode: "party", colorIndex: 0 })
send(a2, { type: "join", name: "LobbyTwo", mode: "party", colorIndex: 1 })
await settled([a1, a2], (s) => has(s, (f) => f.type === "welcome"), 5000, "welcome")

// Room B: full race to finished (arms the alarm)
const b1 = await connect(ROOM_B, "b1")
const b2 = await connect(ROOM_B, "b2")
send(b1, { type: "join", name: "RacerOne", mode: "party", colorIndex: 2 })
send(b2, { type: "join", name: "RacerTwo", mode: "party", colorIndex: 3 })
await settled([b1, b2], (s) => has(s, (f) => f.type === "welcome"), 5000, "welcome")
send(b1, { type: "ready", ready: true })
send(b2, { type: "ready", ready: true })
await waitOn(b1, (s) => has(s, (f) => f.phase === "racing"), 8000, "B racing")
send(b1, { type: "finish", timeMs: 21000 })
send(b2, { type: "finish", timeMs: 22000 })
await waitOn(b1, (s) => has(s, (f) => f.type === "results"), 5000, "B results")
console.log("SETUP OK: A lobby joined (unready), B raced to finished")

// TRIP via external kv put (interop proven earlier)
const verdict = JSON.stringify({
  v: 1,
  tripped: true,
  worst: { meter: "rowsWritten", mtd: 95000, limit: 100000 },
  advisory: { workersRequests: 1 },
  resetsAtIso: new Date(Date.now() + 86_400_000).toISOString(),
  computedAtIso: new Date().toISOString(),
})
const put = Bun.spawnSync(
  ["bunx", "wrangler", "kv", "key", "put", "verdict", verdict, "--binding", "BUDGET", "--local"],
  { cwd: `${import.meta.dir}/../..` },
)
if (put.exitCode !== 0) throw new Error(`kv put failed: ${put.stderr.toString()}`)
console.log("TRIPPED at", new Date().toISOString())

// R4: B drains once the DO-side breaker cache (60s) expires and the next alarm tick runs
await settled([b1, b2], (s) => has(s, pausedErr) && s.closed !== null, 80000, "drain frame + close")
console.log("R4 DRAIN PASS: both B sockets got service_paused and closed", b1.closed, b2.closed)

// R5: A tries to start a race — must be rejected, no countdown ever
send(a1, { type: "ready", ready: true })
send(a2, { type: "ready", ready: true })
await settled(
  [a1, a2],
  (s) => has(s, pausedErr) && s.closed !== null,
  8000,
  "service_paused rejection + close",
)
// Both sockets are closed, so nothing more can arrive: the frames collected up
// to the close events are the complete record - no timing luck involved.
const aCountdown = [a1, a2].some((s) =>
  has(s, (f) => f.type === "phase" && f.phase === "countdown"),
)
if (aCountdown) throw new Error("FAIL: countdown started while tripped")
console.log(
  "R5 LOBBY-BYPASS PASS: ready rejected with service_paused, no countdown, sockets closed",
  a1.closed,
  a2.closed,
)
console.log("PROBE PASS")
