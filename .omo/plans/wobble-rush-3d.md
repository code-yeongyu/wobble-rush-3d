# Plan: Wobble Rush 3D — build, test, deploy, publish

Goal contract: docs/goal.md (C1-C8). Tier HEAVY. Notepad: /var/folders/nj/hqfr8ndn5q56cqw7jqgbrck40000gn/T/ulw-20260725-220631.XXXXXX.md.vy1XuTyUw0

## Architecture
- Single Bun package, strict TS, tsgo typecheck, biome lint, bun test.
- `src/shared/` — pure, framework-free logic (testable): physics (fixed 60Hz step, sphere-vs-AABB/OBB, gravity/jump/coyote/dive), obstacles (sweeper/platform/bumper kinematics + collision response), course definition (typed layout data: platforms, checkpoints, waypoints), NPC AI (seeded deterministic waypoint-follow + jump/dive heuristics), protocol (zod-validated msg codec), room reducer (lobby join/leave/ready/start/finish pure state machine), rng (mulberry32 seeded).
- `src/client/` — Three.js rendering + game shell: Game (loop, fixed-step accumulator), Player (mesh+controller binding), Course (builds meshes from shared course def), Obstacle visuals, Checkpoint visuals, UI (start/lobby/HUD/finish/error screens, DOM), Effects (particle systems), Audio (WebAudio procedural SFX), Net (WS client), Npc visuals.
- `src/server/` — Hono app on CF Workers + RoomDO (WebSocket hibernation, relay + lobby via shared room reducer). Serves static assets via wrangler assets binding.
- Multiplayer model: client-authoritative positions relayed at ~15Hz; server owns lobby state; NPCs deterministic from room seed so all clients render identical NPCs with zero server compute.
- Build: `bun run build` → bundle client to dist/ + copy static; `wrangler dev` local; `wrangler deploy` prod with custom domain wobble-rush.mengmota.com.

## Waves
W0 Bootstrap (me): research lanes (librarian x3, background), scaffold repo (git init, package.json, tsconfig, biome.json, wrangler.jsonc, dirs, index.html shell), commit chore(scaffold).
W1 Interfaces (me): src/shared/types.ts + course-data.ts skeleton + protocol message shapes; DESIGN.md (visual contract). Commit.
W2 Logic fan-out (unspecified-high x4, background, TDD, disjoint dirs):
  A physics+player controller (C1), B obstacles+course collision (C2+C3 logic), C NPC AI (C5), D protocol+room reducer+server (C4).
  Each: failing tests first, RED captured in transcript, then impl GREEN, no cross-dir edits.
W3 Client build (me, while W2 runs): Three.js scene, renderer, camera rig, materials/lighting, character mesh, course visuals, UI screens/HUD CSS, effects, audio, error screen (C6). Integrate W2 outputs as they land.
W4 Integration (me): wire Game loop to shared sim, Net client to server, lobby flow, NPC rendering; bun test all green; tsgo+biome clean. Commits per module.
W5 QA + videos (me): wrangler dev; Playwright scenarios → videos (a) full run (b) respawn (c) 2-player multi (d) NPC race; C6 screenshot. Cleanup receipts.
W6 Deploy (C7): wrangler deploy, custom domain, curl + prod Playwright evidence.
W7 Publish (C8): gh repo create + README + description + topics; push.
W8 Reviewer gate: oracle review with diff+evidence; fix criterion-cited blockers; approval.

## QA scenarios (exact)
- S1 (C1): playwright chromium http://localhost:8787 → click Play Solo → hold KeyW 2s, Space, ShiftLeft; PASS = player z-position advances + jump arc visible in video wobble-demo-singleplayer.webm.
- S2 (C2/C3): scripted route: walk into sweeper → knocked; ride moving platform; fall off bridge → respawn at checkpoint (HUD checkpoint count); reach finish → finish screen shows MM:SS.mmm; click Restart → timer resets. Video respawn-finish.webm.
- S3 (C4): wrangler dev; ctx A create room (code shown), ctx B join code; both ready; race starts; PASS = each page renders the other player's avatar moving. Video multiplayer.webm.
- S4 (C5): solo race with NPCs enabled; PASS = ≥2 NPC avatars leave start and traverse ≥2 obstacles. Video npc-race.webm.
- S5 (C6): playwright route-abort /assets/main.js → PASS = visible error screen text "Failed to load" (no blank page). Screenshot error-screen.png.
- S6 (C7): curl -i https://wobble-rush.mengmota.com/ → HTTP 200 text/html; playwright loads prod, Play Solo works. Screenshot prod.png.
- S7 (C8): gh repo view code-yeongyu/wobble-rush-3d --json name,description,repositoryTopics → contains attribution + topics.
