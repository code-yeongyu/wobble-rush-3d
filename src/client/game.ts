/**
 * Game — the shell that binds simulation, scene and race state together.
 *
 * The simulation is the same pure code the unit tests exercise: `stepRunner` against a
 * `WorldSnapshot` built from the course. Rendering only ever reads simulation state.
 * The race lifecycle (solo/party starts, restarts, phase reactions) lives in
 * `race-director.ts`; this class is construction, wiring, the fixed-step pump
 * and rendering.
 */

import { RUNNER_COLORS, SUNRISE_SCRAMBLE } from "../shared/course"
import type { PlayerId } from "../shared/types"
import { createWorldSnapshot } from "../shared/world"
import { AudioKit } from "./audio"
import { createOrbit, updateOrbit } from "./camera-math"
import { CameraRig } from "./camera-rig"
import { CourseView } from "./course-view"
import { installDebugApi } from "./debug-api"
import { Effects } from "./effects"
import { FrameLoop } from "./frame-loop"
import { InputSource } from "./input"
import { LocalRunner } from "./local-runner"
import { NpcPack } from "./npc-pack"
import { PartyLink } from "./party-link"
import type { PartyPorts } from "./party-wiring"
import { partyEvents } from "./party-wiring"
import { RaceClock } from "./race-clock"
import { RaceDirector } from "./race-director"
import type { FeedbackPorts } from "./race-feedback"
import { applyEvents } from "./race-feedback"
import { localFinisherId, placementLabel, rankFinishers, recordBest } from "./race-results"
import { RemoteRunners } from "./remote-runners"
import type { SceneKit } from "./scene-kit"
import { createSceneKit } from "./scene-kit"
import { Ui } from "./ui"

const PARTY_NPC_COUNT = 2

export class Game {
  private readonly ui: Ui
  private readonly kit: SceneKit
  private readonly camera: CameraRig
  private readonly effects = new Effects()
  private readonly audio = new AudioKit()
  private readonly input = new InputSource()
  private readonly course = SUNRISE_SCRAMBLE
  private readonly courseView: CourseView
  private readonly remotes: RemoteRunners
  private readonly npcs: NpcPack
  private readonly party: PartyLink
  private readonly clock = new RaceClock()
  private readonly runner: LocalRunner
  private readonly director: RaceDirector
  private readonly loop: FrameLoop
  private readonly reducedMotion: boolean

  private selfId: PlayerId | null = null
  private roomCode: string | null = null
  private orbit = createOrbit(SUNRISE_SCRAMBLE.spawnYaw)

  constructor(root: HTMLElement) {
    this.reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.ui = new Ui(root, {
      onPlaySolo: (name, colorIndex) => this.director.startSolo(name, colorIndex),
      onPlayOnline: (name, colorIndex, code) =>
        void this.director.startParty(name, colorIndex, code),
      onReady: (ready) => this.party.send({ type: "ready", ready }),
      onLeaveLobby: () => {
        this.party.leave()
        this.remotes.clear()
        this.director.backToMenu()
      },
      onRestart: () => this.director.restart(),
      onBackToMenu: () => this.director.backToMenu(),
      onToggleSound: (muted) => this.audio.setMuted(muted),
    })

    this.kit = createSceneKit(this.ui.canvas)
    this.camera = new CameraRig(this.kit.camera)
    this.courseView = new CourseView(this.course)
    this.remotes = new RemoteRunners(this.kit.scene)
    this.npcs = new NpcPack(this.kit.scene, this.course)
    this.party = new PartyLink(partyEvents(this.partyPorts()))
    this.runner = new LocalRunner(this.kit.scene, this.course, RUNNER_COLORS[0] ?? "#FF7A5C")
    this.director = new RaceDirector({
      ui: this.ui,
      audio: this.audio,
      clock: this.clock,
      camera: this.camera,
      runner: this.runner,
      remotes: this.remotes,
      npcs: this.npcs,
      party: this.party,
      course: this.course,
      onRunnersReset: () => {
        this.orbit = createOrbit(this.course.spawnYaw)
      },
    })
    this.kit.scene.add(this.courseView.group, this.effects.group)

    globalThis.addEventListener("resize", () => this.kit.resize())
    this.input.attach(this.ui.canvas)
    this.ui.show("start")
    this.camera.snapTo(this.course.spawn, this.course.spawnYaw)
    installDebugApi({
      state: () => ({
        phase: this.clock.phase,
        raceMs: this.clock.raceMs,
        worldTimeSec: this.clock.worldTimeSec,
        checkpoint: this.runner.sim.checkpoint,
        position: { ...this.runner.sim.position },
        remotes: this.remotes.count,
        npcs: this.npcs.size,
        npcProgress: this.npcs.progress(),
        remoteProgress: this.remotes.progress(),
        room: this.roomCode,
      }),
      autopilot: (enabled) => this.runner.setAutopilot(enabled),
    })

    this.loop = new FrameLoop(
      (dt) => this.stepSimulation(dt),
      (dt, nowMs) => this.render(dt, nowMs),
    )
    this.loop.start()
  }

  private get ports(): FeedbackPorts {
    return {
      effects: this.effects,
      audio: this.audio,
      ui: this.ui,
      camera: this.camera,
      runnerColor:
        RUNNER_COLORS[this.director.currentColorIndex % RUNNER_COLORS.length] ?? "#FF7A5C",
      checkpointTotal: this.course.checkpoints.length - 1,
    }
  }

  private partyPorts(): PartyPorts {
    return {
      identify: (you, snapshot, seed) => {
        this.selfId = you
        this.roomCode = snapshot.code
        this.ui.setRoom(snapshot, this.director.playerName)
        this.npcs.spawn(seed, PARTY_NPC_COUNT)
      },
      roster: (snapshot) => {
        this.roomCode = snapshot.code
        this.ui.setRoom(snapshot, this.director.playerName)
        this.remotes.sync(snapshot, this.selfId)
      },
      phase: (phase, endsAtMs, serverNowMs) => this.director.onPhase(phase, endsAtMs, serverNowMs),
      states: (players) => this.remotes.push(players, this.selfId, performance.now()),
      results: (results) => {
        this.director.setResults(results)
        if (this.clock.phase === "finished") this.showFinishScreen()
      },
      failure: (message) => this.ui.showError(message),
      closed: (reason) => {
        if (!this.clock.locked || this.clock.phase === "countdown") {
          this.ui.showError(`Disconnected from the room: ${reason}`)
        }
      },
    }
  }

  private stepSimulation(dt: number): void {
    // Advance the clock first: it owns the world time every obstacle and NPC is
    // sampled at, so the snapshot below must be taken after the step.
    const tick = this.clock.tick(dt, this.director.currentMode === "solo")
    const world = createWorldSnapshot(this.course, this.clock.worldTimeSec)
    if (this.clock.phase === "countdown" || tick.started) this.ui.setCountdown(tick.label)
    if (tick.started) {
      this.audio.play("go")
      globalThis.setTimeout(() => this.ui.setCountdown(null), 450)
    }
    if (this.clock.phase === "racing") this.ui.setTimer(this.clock.raceMs)

    const locked = this.clock.locked
    const manual = this.input.sample(this.orbit.yaw, locked)
    if (!locked || this.runner.autopilotActive) {
      const events = this.runner.step(world, this.clock.worldTimeSec, dt, manual)
      if (applyEvents(events, this.ports, true).finished && this.clock.phase === "racing")
        this.finishRace()
    }

    if (this.input.consumeRespawn() && this.clock.phase === "racing") {
      this.runner.respawn()
      this.effects.respawn(this.runner.sim.position)
      this.audio.play("respawn")
    }

    this.npcs.step(
      { world, timeSec: this.clock.worldTimeSec, dt, locked, raceMs: this.clock.raceMs },
      (npcEvents) => {
        applyEvents(npcEvents, this.ports, false)
      },
    )
  }

  private finishRace(): void {
    this.clock.finish()
    this.effects.finish(this.runner.sim.position)
    this.audio.play("finish")
    this.audio.stopMusic()
    this.party.send({ type: "finish", timeMs: Math.round(this.clock.raceMs) })
    if (this.director.currentMode === "solo") this.showFinishScreen()
  }

  private showFinishScreen(): void {
    const best = recordBest(this.clock.raceMs, globalThis.localStorage)
    const results =
      this.director.raceResults.length > 0
        ? this.director.raceResults
        : rankFinishers([
            {
              id: localFinisherId(0),
              name: this.director.playerName,
              timeMs: Math.round(this.clock.raceMs),
            },
            ...this.npcs.finishers(1),
          ])
    this.ui.showFinish(this.clock.raceMs, best.note, results)
  }

  private render(dt: number, nowMs: number): void {
    this.courseView.update(this.clock.worldTimeSec, this.reducedMotion)
    this.runner.render(dt)
    this.npcs.render(dt)
    this.remotes.render(nowMs, dt)
    this.effects.update(dt)

    const sim = this.runner.sim
    this.orbit = updateOrbit(this.orbit, this.input.takeOrbitDelta(), sim.velocity, dt)
    this.camera.update(sim.position, sim.velocity, this.orbit, dt, this.reducedMotion)
    this.kit.sun.position.set(sim.position.x + 28, 46, sim.position.z - 18)
    this.kit.sun.target.position.set(sim.position.x, 0, sim.position.z)
    this.kit.sun.target.updateMatrixWorld()

    if (this.clock.phase === "racing") {
      this.ui.setPlace(
        placementLabel(sim.position.z, [...this.npcs.progress(), ...this.remotes.progress()]),
      )
    }
    if (this.director.currentMode === "party" && this.clock.phase === "racing") {
      this.party.sendState(nowMs, {
        type: "state",
        p: [sim.position.x, sim.position.y, sim.position.z],
        v: [sim.velocity.x, sim.velocity.y, sim.velocity.z],
        yaw: sim.yaw,
        st: sim.state,
        cp: sim.checkpoint,
      })
    }
    this.kit.render()
  }

  dispose(): void {
    this.loop.stop()
    this.input.detach(this.ui.canvas)
    this.party.close()
    this.audio.dispose()
    this.effects.dispose()
    this.runner.dispose()
    this.npcs.dispose()
    this.remotes.clear()
    this.kit.dispose()
  }
}
