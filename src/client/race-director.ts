/**
 * RaceDirector — owns the race lifecycle: starting solo/party runs, returning
 * to the menu, restarting, and reacting to room phase changes. Holds the mode,
 * the local player's chosen name/colour and the latest race results.
 */

import { NET } from "../shared/constants"
import { RUNNER_COLORS } from "../shared/course"
import type { RaceResult, RoomPhase } from "../shared/room"
import type { CourseDefinition } from "../shared/types"
import { asCheckpointIndex, assertNever } from "../shared/types"
import type { AudioKit } from "./audio"
import type { CameraRig } from "./camera-rig"
import type { LocalRunner } from "./local-runner"
import type { NpcPack } from "./npc-pack"
import type { PartyLink } from "./party-link"
import type { RaceClock } from "./race-clock"
import type { RemoteRunners } from "./remote-runners"
import type { Ui } from "./ui"

const SOLO_NPC_COUNT = 4

export type GameMode = "solo" | "party"

export type RaceDirectorPorts = {
  readonly ui: Ui
  readonly audio: AudioKit
  readonly clock: RaceClock
  readonly camera: CameraRig
  readonly runner: LocalRunner
  readonly remotes: RemoteRunners
  readonly npcs: NpcPack
  readonly party: PartyLink
  readonly course: CourseDefinition
  /** Lets the owner re-aim camera state whenever the runners reset. */
  readonly onRunnersReset: () => void
}

export class RaceDirector {
  private mode: GameMode = "solo"
  private selfName = "Wobbler"
  private colorIndex = 0
  private results: readonly RaceResult[] = []

  constructor(private readonly ports: RaceDirectorPorts) {}

  get currentMode(): GameMode {
    return this.mode
  }

  get playerName(): string {
    return this.selfName
  }

  get currentColorIndex(): number {
    return this.colorIndex
  }

  get raceResults(): readonly RaceResult[] {
    return this.results
  }

  setResults(results: readonly RaceResult[]): void {
    this.results = results
  }

  startSolo(name: string, colorIndex: number): void {
    const { audio, remotes, npcs } = this.ports
    audio.unlock()
    audio.play("click")
    this.mode = "solo"
    this.selfName = name
    this.applyColor(colorIndex)
    remotes.clear()
    npcs.spawn(Math.floor(Math.random() * 1_000_000), SOLO_NPC_COUNT)
    this.beginRace()
  }

  async startParty(name: string, colorIndex: number, code: string | null): Promise<void> {
    const { audio, remotes, party, ui } = this.ports
    audio.unlock()
    audio.play("click")
    this.mode = "party"
    this.selfName = name
    this.applyColor(colorIndex)
    remotes.clear()
    await party.join(code, { type: "join", name, mode: "party", colorIndex })
    if (party.active) ui.show("lobby")
  }

  backToMenu(): void {
    const { clock, audio, ui, party, remotes } = this.ports
    // Leaving the menu must also leave the room, or a stale socket keeps
    // pushing this client's next solo run around.
    if (this.mode === "party") {
      party.leave()
      remotes.clear()
      this.mode = "solo"
    }
    clock.idle()
    audio.stopMusic()
    this.resetRunners()
    ui.show("start")
  }

  restart(): void {
    const { party, ui, npcs } = this.ports
    if (this.mode === "party" && party.active) {
      party.send({ type: "restart" })
      ui.resetReadyButton()
      ui.show("lobby")
      return
    }
    npcs.spawn(Math.floor(Math.random() * 1_000_000), SOLO_NPC_COUNT)
    this.beginRace()
  }

  onPhase(phase: RoomPhase, endsAtMs: number | null, serverNowMs: number): void {
    const { clock, ui, audio } = this.ports
    switch (phase) {
      case "lobby":
        clock.idle()
        ui.resetReadyButton()
        ui.show("lobby")
        break
      case "countdown": {
        this.resetRunners()
        // Anchor the world clock to the server's countdown so every client drives
        // obstacles and NPCs from the same time base.
        const remaining =
          endsAtMs === null ? NET.countdownSec : Math.max(0, (endsAtMs - serverNowMs) / 1000)
        clock.beginCountdown(remaining, Math.max(0, NET.countdownSec - remaining))
        ui.show("hud")
        audio.startMusic()
        break
      }
      case "racing":
        clock.startRacing()
        ui.setCountdown(null)
        break
      case "finished":
        break
      default:
        assertNever(phase, "onPhase")
    }
    ui.setPhaseHint(phase)
  }

  private beginRace(): void {
    const { clock, ui, camera, audio, course } = this.ports
    this.resetRunners()
    this.results = []
    clock.beginCountdown(NET.countdownSec)
    ui.show("hud")
    ui.setTimer(0)
    ui.setCheckpoints(0, course.checkpoints.length - 1)
    ui.setPlace("")
    camera.snapTo(course.spawn, course.spawnYaw)
    audio.startMusic()
  }

  private resetRunners(): void {
    const { runner, npcs, course } = this.ports
    const start = course.checkpoints[0]?.index ?? asCheckpointIndex(0)
    runner.reset(start)
    npcs.reset(start)
    this.ports.onRunnersReset()
  }

  private applyColor(colorIndex: number): void {
    this.colorIndex = colorIndex
    this.ports.runner.setColor(RUNNER_COLORS[colorIndex % RUNNER_COLORS.length] ?? "#FF7A5C")
  }
}
