/**
 * Game — the shell that binds simulation, scene and race state together.
 *
 * The simulation is the same pure code the unit tests exercise: `stepRunner` against a
 * `WorldSnapshot` built from the course. Rendering only ever reads simulation state.
 */

import { NET } from "../shared/constants"
import { RUNNER_COLORS, SUNRISE_SCRAMBLE } from "../shared/course"
import type { RaceResult, RoomPhase } from "../shared/room"
import type { CheckpointIndex, PlayerId } from "../shared/types"
import { assertNever } from "../shared/types"
import { createWorldSnapshot } from "../shared/world"
import { AudioKit } from "./audio"
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
import type { FeedbackPorts } from "./race-feedback"
import { applyEvents } from "./race-feedback"
import { localFinisherId, placementLabel, rankFinishers, recordBest } from "./race-results"
import { RemoteRunners } from "./remote-runners"
import type { SceneKit } from "./scene-kit"
import { createSceneKit } from "./scene-kit"
import { Ui } from "./ui"

const SOLO_NPC_COUNT = 4
const PARTY_NPC_COUNT = 2

type GameMode = "solo" | "party"

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
  private readonly loop: FrameLoop
  private readonly reducedMotion: boolean

  private selfId: PlayerId | null = null
  private selfName = "Wobbler"
  private colorIndex = 0
  private mode: GameMode = "solo"
  private roomCode: string | null = null
  private results: readonly RaceResult[] = []
  private simTime = 0
  private orbitYaw = 0

  constructor(root: HTMLElement) {
    this.reducedMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.ui = new Ui(root, {
      onPlaySolo: (name, colorIndex) => this.startSolo(name, colorIndex),
      onPlayOnline: (name, colorIndex, code) => void this.startParty(name, colorIndex, code),
      onReady: (ready) => this.party.send({ type: "ready", ready }),
      onLeaveLobby: () => {
        this.party.leave()
        this.remotes.clear()
        this.backToMenu()
      },
      onRestart: () => this.restart(),
      onBackToMenu: () => this.backToMenu(),
      onToggleSound: (muted) => this.audio.setMuted(muted),
    })

    this.kit = createSceneKit(this.ui.canvas)
    this.camera = new CameraRig(this.kit.camera)
    this.courseView = new CourseView(this.course)
    this.remotes = new RemoteRunners(this.kit.scene)
    this.npcs = new NpcPack(this.kit.scene, this.course)
    this.party = new PartyLink(partyEvents(this.partyPorts()))
    this.runner = new LocalRunner(this.kit.scene, this.course, RUNNER_COLORS[0] ?? "#FF7A5C")
    this.kit.scene.add(this.courseView.group, this.effects.group)

    globalThis.addEventListener("resize", () => this.kit.resize())
    this.input.attach(this.ui.canvas)
    this.ui.show("start")
    this.camera.snapTo(this.course.spawn, this.course.spawnYaw)
    installDebugApi({
      state: () => ({
        phase: this.clock.phase,
        raceMs: this.clock.raceMs,
        checkpoint: this.runner.sim.checkpoint,
        position: { ...this.runner.sim.position },
        remotes: this.remotes.count,
        npcs: this.npcs.size,
        npcProgress: this.npcs.progress(),
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
      runnerColor: RUNNER_COLORS[this.colorIndex % RUNNER_COLORS.length] ?? "#FF7A5C",
      checkpointTotal: this.course.checkpoints.length - 1,
    }
  }

  private partyPorts(): PartyPorts {
    return {
      identify: (you, snapshot, seed) => {
        this.selfId = you
        this.roomCode = snapshot.code
        this.ui.setRoom(snapshot, this.selfName)
        this.npcs.spawn(seed, PARTY_NPC_COUNT)
      },
      roster: (snapshot) => {
        this.roomCode = snapshot.code
        this.ui.setRoom(snapshot, this.selfName)
        this.remotes.sync(snapshot, this.selfId)
      },
      phase: (phase, endsAtMs, serverNowMs) => this.onPhase(phase, endsAtMs, serverNowMs),
      states: (players) => this.remotes.push(players, this.selfId, performance.now()),
      results: (results) => {
        this.results = results
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

  private startSolo(name: string, colorIndex: number): void {
    this.audio.unlock()
    this.audio.play("click")
    this.mode = "solo"
    this.selfName = name
    this.applyColor(colorIndex)
    this.remotes.clear()
    this.npcs.spawn(Math.floor(Math.random() * 1_000_000), SOLO_NPC_COUNT)
    this.beginRace()
  }

  private async startParty(name: string, colorIndex: number, code: string | null): Promise<void> {
    this.audio.unlock()
    this.audio.play("click")
    this.mode = "party"
    this.selfName = name
    this.applyColor(colorIndex)
    this.remotes.clear()
    await this.party.join(code, { type: "join", name, mode: "party", colorIndex })
    if (this.party.active) this.ui.show("lobby")
  }

  private backToMenu(): void {
    this.clock.idle()
    this.audio.stopMusic()
    this.resetRunners()
    this.ui.show("start")
  }

  private restart(): void {
    if (this.mode === "party" && this.party.active) {
      this.party.send({ type: "restart" })
      this.ui.resetReadyButton()
      this.ui.show("lobby")
      return
    }
    this.npcs.spawn(Math.floor(Math.random() * 1_000_000), SOLO_NPC_COUNT)
    this.beginRace()
  }

  private beginRace(): void {
    this.resetRunners()
    this.results = []
    this.clock.beginCountdown(NET.countdownSec)
    this.ui.show("hud")
    this.ui.setTimer(0)
    this.ui.setCheckpoints(0, this.course.checkpoints.length - 1)
    this.ui.setPlace("")
    this.camera.snapTo(this.course.spawn, this.course.spawnYaw)
    this.audio.startMusic()
  }

  private resetRunners(): void {
    const start = this.course.checkpoints[0]?.index ?? (0 as CheckpointIndex)
    this.runner.reset(start)
    this.npcs.reset(start)
    this.orbitYaw = this.course.spawnYaw
  }

  private applyColor(colorIndex: number): void {
    this.colorIndex = colorIndex
    this.runner.setColor(RUNNER_COLORS[colorIndex % RUNNER_COLORS.length] ?? "#FF7A5C")
  }

  private onPhase(phase: RoomPhase, endsAtMs: number | null, serverNowMs: number): void {
    switch (phase) {
      case "lobby":
        this.clock.idle()
        this.ui.resetReadyButton()
        this.ui.show("lobby")
        break
      case "countdown":
        this.resetRunners()
        this.clock.beginCountdown(
          endsAtMs === null ? NET.countdownSec : Math.max(0, (endsAtMs - serverNowMs) / 1000),
        )
        this.ui.show("hud")
        this.audio.startMusic()
        break
      case "racing":
        this.clock.startRacing()
        this.ui.setCountdown(null)
        break
      case "finished":
        break
      default:
        assertNever(phase, "onPhase")
    }
    this.ui.setPhaseHint(phase)
  }

  private stepSimulation(dt: number): void {
    this.simTime += dt
    const world = createWorldSnapshot(this.course, this.simTime)

    const tick = this.clock.tick(dt, this.mode === "solo")
    if (this.clock.phase === "countdown" || tick.started) this.ui.setCountdown(tick.label)
    if (tick.started) {
      this.audio.play("go")
      globalThis.setTimeout(() => this.ui.setCountdown(null), 450)
    }
    if (this.clock.phase === "racing") this.ui.setTimer(this.clock.raceMs)

    const locked = this.clock.locked
    const manual = this.input.sample(this.orbitYaw, locked)
    if (!locked || this.runner.autopilotActive) {
      const events = this.runner.step(world, this.simTime, dt, manual)
      if (applyEvents(events, this.ports, true).finished && this.clock.phase === "racing")
        this.finishRace()
    }

    if (this.input.consumeRespawn() && this.clock.phase === "racing") {
      this.runner.respawn()
      this.effects.respawn(this.runner.sim.position)
      this.audio.play("respawn")
    }

    this.npcs.step(
      { world, timeSec: this.simTime, dt, locked, raceMs: this.clock.raceMs },
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
    if (this.mode === "solo") this.showFinishScreen()
  }

  private showFinishScreen(): void {
    const best = recordBest(this.clock.raceMs, globalThis.localStorage)
    const results =
      this.results.length > 0
        ? this.results
        : rankFinishers([
            { id: localFinisherId(0), name: this.selfName, timeMs: Math.round(this.clock.raceMs) },
            ...this.npcs.finishers(1),
          ])
    this.ui.showFinish(this.clock.raceMs, best.note, results)
  }

  private render(dt: number, nowMs: number): void {
    this.courseView.update(this.simTime, this.reducedMotion)
    this.runner.render(dt)
    this.npcs.render(dt)
    this.remotes.render(nowMs, dt)
    this.effects.update(dt)

    const sim = this.runner.sim
    this.orbitYaw = this.camera.followHeading(sim.velocity, this.input.takeDragYaw(), dt)
    this.camera.update(sim.position, sim.velocity, this.orbitYaw, dt, this.reducedMotion)
    this.kit.sun.position.set(sim.position.x + 28, 46, sim.position.z - 18)
    this.kit.sun.target.position.set(sim.position.x, 0, sim.position.z)
    this.kit.sun.target.updateMatrixWorld()

    if (this.clock.phase === "racing") {
      this.ui.setPlace(
        placementLabel(sim.position.z, [...this.npcs.progress(), ...this.remotes.progress()]),
      )
    }
    if (this.mode === "party" && this.clock.phase === "racing") {
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
