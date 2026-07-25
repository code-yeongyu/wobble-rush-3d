# Wobble Rush 3D — Goal Contract

## Deliverable (user-visible, one line)
A repo runnable with one command: opening `http://127.0.0.1:8787/` shows a polished **Wobble Rush 3D** start screen; Play drops into a colorful animated 3D obstacle course where an original rounded character runs/jumps/dives (WASD + Space + Shift) under a third-person follow camera past rotating sweeper bars, moving platforms, bouncing bumpers, a narrow bridge and a final ramp/gate into a finish zone — with timer + checkpoint HUD, fall→checkpoint respawn, finish screen with time + restart, particles + procedural SFX — plus a Multiplayer mode with lobby/room codes where multiple real clients and NPC bots race in one room over WebSockets; the same server code runs on Bun locally and deploys to Cloudflare Workers (Durable Objects).

## Tier
**HEAVY** — new codebase with multiple new modules/layers, an external realtime integration (WebSocket + Durable Objects), server-side concurrency (fixed-rate tick loop over multi-client room state), and an explicit demand for multi-scenario recorded video evidence.

## Binding stack constraints
TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; no `any`, no type assertions, no `!`, no `enum`, no default exports), Bun runtime, Hono server, Zod at boundaries, Biome lint+format, `tsgo --noEmit` typecheck, `bun test`, Three.js rendering, clear modules/classes (Game, Player, Course, Obstacle, Checkpoint, UI, Effects, Audio, NetClient, Bot, RoomServer), **no silent fallbacks** (Three.js / asset / WS failure shows a clear error overlay), ≤250 pure LOC per file. Visuals via imagegen where textures help; browser QA via agent-browser/Playwright — **never** computer-use.

## Success criteria
Each criterion: failing-first proof captured RED **before** implementation, GREEN after, plus a real-surface artifact.

### C1 — Shared deterministic simulation
Fixed-timestep sim (movement, gravity, jump + coyote + buffer, dive, AABB resolution, moving-platform carry, bumper bounce, checkpoint capture, fall-respawn, finish detection).
- Proof: `bun test` on the sim package — RED before impl, GREEN after. Includes determinism (same seed + inputs ⇒ identical state hash) and edges (below kill plane, landing on platform edge, double-jump denied, dive cooldown).
- Evidence: `evidence/c1-sim-red.txt`, `evidence/c1-sim-green.txt`.

### C2 — Playable single-player course in a real browser
- Scenario: `agent-browser open http://127.0.0.1:8787/` → click Play. PASS iff the canvas renders 3D content (screenshot non-blank), `window.__wr3d.state === "playing"`, console error count === 0.
- Evidence: `evidence/c2-start.png`, `evidence/c2-playing.png`, `evidence/c2-console.json`.

### C3 — Movement verbs (run / jump / dive)
- Scenario: Playwright holds `KeyW` 1.5s, then `Space`, then `ShiftLeft`. PASS iff telemetry shows z advanced > 8 units, a jump with airborne > 0.25s, and a dive with a speed spike above run speed.
- Evidence: `evidence/c3-telemetry.json` + video.

### C4 — Obstacles live and interactive
- Scenario: scripted runs colliding with each obstacle type. PASS iff telemetry records a sweeper hit imparting lateral velocity, a platform-carry frame (player moves with the platform with no input), and a bumper impulse.
- Evidence: `evidence/c4-obstacles.json` + video.

### C5 — Fall → respawn → finish → restart loop
- Scenario: scripted walk off the edge → respawn at latest checkpoint (position ≈ checkpoint) → full run to finish → finish screen with formatted time → Restart returns to a fresh playable run (timer + checkpoints reset).
- Evidence: `evidence/c5-respawn.png`, `evidence/c5-finish.png`, `evidence/c5-restart.png` + video.

### C6 — Multiplayer over WebSockets on Bun
- Scenario: start the Bun server; 2 Playwright browser contexts join the same room code; client A moves. PASS iff client B's telemetry reports A's remote avatar position delta > 3 units within 2s and both report room player count === 2.
- Evidence: `evidence/c6-two-clients.png`, `evidence/c6-net-log.json` + video.

### C7 — NPC bots race
- Scenario: headless harness runs 8 bots through a full race. PASS iff ≥6 bots finish inside the time budget and none is stuck (monotone progress over 5s windows); plus browser evidence of bot avatars moving.
- Evidence: `evidence/c7-bot-race.txt`, `evidence/c7-bots.png` + video.

### C8 — Cloudflare Workers deployability
- Scenario: `bunx wrangler dev --local` on the worker package; a WS client connects to the Durable Object room, sends input, receives snapshots. PASS iff ≥3 snapshot frames arrive containing the client's own player, and `wrangler deploy --dry-run` exits 0.
- Evidence: `evidence/c8-workerd-ws.txt`, `evidence/c8-dry-run.txt`.

### C9 — Lobby + sound + effects polish
- Scenario: click-through Start → Lobby (mode, name, room code, bot count) → race. PASS iff `AudioContext.state === "running"` after the gesture, ≥4 distinct SFX triggers logged in a run, and effect counters (land/dive/checkpoint/finish particles) > 0.
- Evidence: `evidence/c9-lobby.png`, `evidence/c9-audio-effects.json`.

### C10 — Error transparency (no silent fallbacks)
- Scenario: force a failure (block the Three.js module URL; point the client at a dead WS URL). PASS iff a visible error overlay with a specific message appears instead of a blank screen or a silent retry loop.
- Evidence: `evidence/c10-error-overlay.png`, `evidence/c10-ws-error.png`.

### C11 — Quality gates green
`bunx biome check .` clean, `bunx tsgo --noEmit` clean for every package, `bun test` all green, no source file over 250 pure LOC.
- Evidence: `evidence/c11-gates.txt`.

### C12 — Demo videos (multiple scenarios)
≥4 distinct mp4s: (1) single-player full run, (2) obstacle interactions, (3) respawn + finish + restart, (4) multiplayer 2-client race with bots. Each non-blank and playable (ffprobe duration > 5s, sampled frame non-uniform).
- Evidence: `evidence/videos/*.mp4`, `evidence/c12-ffprobe.txt`.

## WHEN TO STOP
I'll stop right away when C1–C12 all PASS with their evidence artifacts on disk, every QA process/port/tmp resource has a recorded teardown receipt, the notepad is current, and the oracle reviewer has approved unconditionally.
