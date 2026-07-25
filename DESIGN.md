# DESIGN.md — Wobble Rush 3D

The visual contract. Every colour, material, motion curve and UI component in the game
resolves to a token defined here. Nothing in this document references, reuses or imitates
Fall Guys artwork, characters, names or trademarks — the shape language, palette and
mascot below are original to Wobble Rush 3D.

## 0. Research Log

| Lane | Deliverable | Outcome |
|---|---|---|
| Level & art-direction research (librarian) | obstacle tuning values, pacing heuristics, HUD conventions, palette construction rules | Sweeper 150°/s and 2 s telegraph dwell adopted as starting points; checkpoint-after-every-knockdown-hazard rule adopted; `MM:SS.mmm` stopwatch adopted; **explicit IP warning logged** — ripped Fall Guys rigs found in public clone repos, none used here. |
| Three.js technique research (librarian, 2 lanes) | r180+ kinematic controller, `games_fps` substep loop, capsule/AABB resolution, `MeshPhysicalMaterial` clearcoat, `RoomEnvironment` + PMREM, `PCFSoftShadowMap`, `Points` particles, `InstancedMesh` | Fixed-step accumulator + capped substeps adopted; slope-threshold ground test (`normal.y >= 0.6`, stricter than the example's 0.15 because our decks are flat) adopted; ACESFilmic + SRGB output adopted; PMREM room environment adopted for the glossy toy look. |
| Cloudflare/Hono research (librarian) | DO WebSocket Hibernation API, wrangler assets + custom domain config | Hibernation handlers + `serializeAttachment` adopted; `routes[].custom_domain` adopted for the mengmota.com hostname. |
| Embedded Layer-A/Layer-B brand references | *skipped* | The surface is a 3D game canvas with a thin HUD overlay, not a marketing/product UI. The curated brand systems (Linear/Stripe/Notion-class product UI) do not describe a toy-arcade game shell, so the palette and motion language below are authored from the colour-theory and game-art-direction findings instead. Recorded as a deliberate skip, per the design gate. |

## 1. Brand posture

**Wobble Rush 3D** is a bright plastic toybox. Everything reads as injection-moulded vinyl
under a soft studio light: chunky rounded shapes, thick silhouettes, saturated candy colour,
zero grit. The camera is generous, the motion is springy, and nothing is ever grey.

Three rules decide every visual call:

1. **Silhouette first.** Every hazard reads at 40 m by shape alone — a spinning arm, a
   bobbing dome, a sliding slab. If you must read the colour to know it will hurt, the
   shape has failed.
2. **Danger is warm, safe is cool.** Hazards live in the coral/amber half of the wheel;
   decks and rest pads live in the aqua/lime half. This holds even for colour-blind players
   because hazards also carry diagonal caution stripes and are always in motion.
3. **Depth, never flatness.** Materials get clearcoat, environment reflection and contact
   shadow. Backgrounds get a vertical gradient plus parallax bodies. A flat fill anywhere
   is a bug.

## 2. Palette

Authored for this project. Hex values are sRGB; the renderer converts on upload.

| Token | Hex | Use |
|---|---|---|
| `deck.aqua` | `#5CC9F5` | Primary running deck |
| `deck.sun` | `#FFD25E` | Secondary deck, alternating segments |
| `deck.rest` | `#8FE870` | Rest pads and checkpoint platforms |
| `deck.bridge` | `#FFA94D` | The narrow bridge |
| `deck.ramp` | `#FF87C3` | Final ramp |
| `hazard.core` | `#FF5A6E` | Sweeper arms — the one true "this hurts" colour |
| `hazard.stripe` | `#FFD400` | Caution striping on every hazard |
| `bumper.body` | `#FF7AD9` | Bouncing bumper domes |
| `mover.body` | `#A98BFF` | Moving platforms / ferries |
| `finish.gold` | `#FFE45E` | Finish gate, banner, confetti |
| `ink` | `#2A2440` | Silhouette rim, HUD text, outlines |
| `sky.top` | `#7FA8FF` | Sky gradient zenith |
| `sky.horizon` | `#FFE0C0` | Sky gradient horizon |
| `cloud` | `#FFFFFF` | Background blimps, clouds, arches |

Runner colours (per player / NPC index, cycled):

`#FF7A5C` `#5CC9F5` `#8FE870` `#FFD25E` `#C98BFF` `#FF7AD9` `#5CE8C8` `#FFA94D`

Each runner also gets a belly panel at 92 % lightness of its body colour and an `ink` rim.

## 3. Materials

One material family: **glossy vinyl**. Built on `MeshPhysicalMaterial` lit by a PMREM-filtered
`RoomEnvironment`, tone-mapped with `ACESFilmicToneMapping`, output in `SRGBColorSpace`.

| Surface | roughness | metalness | clearcoat | clearcoatRoughness | Notes |
|---|---|---|---|---|---|
| Deck / platform | 0.34 | 0.0 | 0.55 | 0.28 | envMapIntensity 0.85 |
| Hazard (sweeper) | 0.22 | 0.0 | 0.9 | 0.12 | emissive at 6 % of base for pop |
| Bumper dome | 0.18 | 0.0 | 1.0 | 0.08 | sheen 0.35, springy highlight |
| Mover | 0.30 | 0.0 | 0.7 | 0.2 | |
| Runner body | 0.28 | 0.0 | 0.85 | 0.15 | sheen 0.4, sheenColor white |
| Finish gate | 0.25 | 0.15 | 0.9 | 0.1 | emissive pulse at 1.6 s period |
| Background bodies | 0.6 | 0.0 | 0.0 | — | unlit-ish, low contrast, never competes |

Shadows: single directional key light, `PCFSoftShadowMap`, 2048² map, `bias -0.0004`,
`normalBias 0.02`, ortho frustum fitted to the course width. Ambient fill from the
environment map only — no flat `AmbientLight` washing the palette out.

## 4. Character — "Wobble", the runner

Original mascot. Deliberately **not** a bean with a face on the front.

- **Silhouette:** a weeble. One rounded-egg body, widest at 40 % height, tapering to a small
  integrated dome on top — the head is a bulge of the body, not a separate ball.
- **Proportions:** total height 1.5 × body width. Dome ≈ 0.3 of total height. Two stubby
  cylindrical legs ≈ 0.17 of total height with flared feet wider than the legs.
- **Limbs:** no arms — two small nubs that swing in the run cycle.
- **Face:** two high eye dots on the dome, no mouth. Expression comes from body tilt and squash.
- **Signature accessory:** a single antenna with a ball tip that lags behind the body
  (spring-damped), plus a numbered race bib on the belly panel. The antenna is the read at
  distance and the thing that sells the wobble.
- **Colour-blocking:** saturated body colour, lighter belly panel, `ink` rim, `hazard.stripe`
  antenna ball.
- **Motion:** squash on landing (scale y 0.82 / xz 1.12, recovering over 180 ms), stretch at
  jump apex (y 1.1), lean into acceleration up to 14°, full-body roll while diving.

## 5. Motion language

| Event | Curve | Duration |
|---|---|---|
| Camera follow | exponential damping, half-life 0.12 s position / 0.09 s target | continuous |
| Landing squash | `easeOutBack` | 180 ms |
| Dive | body pitches 70° forward, `easeOutCubic` | 420 ms |
| Checkpoint pop | ring scales 0 → 3.2 m, opacity 1 → 0 | 600 ms |
| Finish confetti | 220 points, gravity 9 m/s², random spin | 2.5 s |
| HUD panel in | translateY 12 px + fade, `cubic-bezier(.2,.9,.25,1)` | 260 ms |
| Countdown digit | scale 1.6 → 1.0 with overshoot | 400 ms each |

Nothing linear-eases. Nothing takes longer than 600 ms except celebration effects.

## 6. Effects budget

| Effect | Implementation | Count |
|---|---|---|
| Landing puff | `Points`, additive, radial burst | 18 per landing |
| Dive trail | `Points` ribbon behind the runner | 30 alive |
| Checkpoint burst | expanding ring mesh + 24 points | one-shot |
| Respawn sparkle | vertical column of 26 points | one-shot |
| Finish confetti | 220 points, two-tone | one-shot |
| Speed lines | fading `Line` segments while diving | 12 |

All particle systems share one pooled `BufferGeometry` per kind. No per-frame allocation.

## 7. Background life

The course floats in a sky box with a vertical gradient (`sky.top` → `sky.horizon`). Behind
it: three parallax layers of soft cloud slabs drifting at 0.6 / 1.1 / 1.8 m/s, four blimp
bodies bobbing on sine paths, and two giant inflatable arches that rotate slowly. All are
`decor` platforms with no collision and never enter the play corridor.

## 8. UI system

DOM overlay above the canvas. One font stack, one radius scale, one shadow scale.

- **Type:** `"Baloo 2", "Nunito", system-ui, sans-serif` for display; tabular numerals for the
  timer (`font-variant-numeric: tabular-nums`) so digits do not jitter.
- **Radius:** 8 / 14 / 22 / 999 px.
- **Elevation:** `0 6px 0 rgba(42,36,64,.28)` (chunky toy drop) for buttons, `0 12px 40px
  rgba(42,36,64,.22)` for panels.
- **Buttons:** solid fill, 3 px `ink` outline, 6 px bottom offset that collapses to 2 px on
  `:active` — physical, pressable, toy-like.

Screens:

| Screen | Contents |
|---|---|
| Start | Logo lockup, tagline, **Play Solo** / **Play Online** buttons, name field, colour picker, sound toggle |
| Lobby | Room code (large, copyable), player chips with ready state, Ready button, Start hint, Leave |
| HUD | Timer top-centre (`MM:SS.mmm`, tabular), checkpoint pips top-left, position/among-runners top-right, controls hint bottom-centre fading after 6 s |
| Countdown | Full-screen 3 · 2 · 1 · GO overlay, input locked until GO |
| Finish | Final time, personal best delta, placement table for multiplayer, **Race Again** / **Back to Menu** |
| Error | Solid panel, plain-language cause, retry button. Shown for any failed module/asset load — never a blank canvas, never a silent fallback |

Accessibility: all interactive elements are real focusable controls with visible focus rings;
the countdown and results are announced through an `aria-live` region; the game is fully
playable with keyboard only; `prefers-reduced-motion` halves camera shake and disables
parallax drift.

## 9. Accepted debt

- The runner is built from primitives in code rather than an authored mesh; a real sculpt
  would improve the silhouette but costs an asset pipeline this scope does not need.
- Remote-player interpolation is position-only (no full state reconciliation); acceptable for
  a friendly race, not for a competitive ladder.
- One course ships. The course format is data-driven, so more are additive.
