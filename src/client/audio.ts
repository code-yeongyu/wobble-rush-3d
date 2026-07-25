/**
 * Procedural sound. Every cue is synthesised with WebAudio oscillators and noise
 * buffers — no sampled assets, nothing licensed, nothing to fail to download.
 */

export class AudioUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebAudio is unavailable: ${cause}`)
    this.name = "AudioUnavailableError"
  }
}

const CUES = [
  "jump",
  "land",
  "dive",
  "hit",
  "bounce",
  "checkpoint",
  "respawn",
  "finish",
  "click",
  "countdown",
  "go",
] as const
export type Cue = (typeof CUES)[number]

export class AudioKit {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private musicGain: GainNode | null = null
  private musicTimer: ReturnType<typeof globalThis.setInterval> | null = null
  private enabled = true

  get muted(): boolean {
    return !this.enabled
  }

  /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
  unlock(): void {
    if (this.context !== null) {
      if (this.context.state === "suspended") void this.context.resume()
      return
    }
    const Ctor = globalThis.AudioContext
    if (Ctor === undefined) throw new AudioUnavailableError("AudioContext constructor missing")
    const context = new Ctor()
    const master = context.createGain()
    master.gain.value = this.enabled ? 0.5 : 0
    master.connect(context.destination)
    const music = context.createGain()
    music.gain.value = 0.16
    music.connect(master)
    this.context = context
    this.master = master
    this.musicGain = music
  }

  setMuted(muted: boolean): void {
    this.enabled = !muted
    if (this.master !== null && this.context !== null) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.context.currentTime, 0.05)
    }
  }

  play(cue: Cue): void {
    const context = this.context
    const master = this.master
    if (context === null || master === null || !this.enabled) return
    const now = context.currentTime

    switch (cue) {
      case "jump":
        this.blip(now, 330, 620, 0.16, "triangle", 0.28)
        break
      case "land":
        this.thud(now, 0.16)
        break
      case "dive":
        this.sweep(now, 720, 180, 0.3, 0.22)
        break
      case "hit":
        this.noise(now, 0.28, 900, 0.4)
        this.blip(now, 180, 90, 0.24, "square", 0.2)
        break
      case "bounce":
        this.blip(now, 240, 880, 0.22, "sine", 0.32)
        break
      case "checkpoint":
        this.arpeggio(now, [523.25, 659.25, 783.99], 0.1, 0.22)
        break
      case "respawn":
        this.sweep(now, 180, 640, 0.34, 0.2)
        break
      case "finish":
        this.arpeggio(now, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.13, 0.3)
        break
      case "click":
        this.blip(now, 620, 760, 0.07, "triangle", 0.18)
        break
      case "countdown":
        this.blip(now, 440, 440, 0.14, "square", 0.22)
        break
      case "go":
        this.arpeggio(now, [659.25, 987.77], 0.12, 0.34)
        break
      default:
        return
    }
  }

  /** A four-bar bouncy loop that ticks along under the race. */
  startMusic(): void {
    const context = this.context
    const music = this.musicGain
    if (context === null || music === null || this.musicTimer !== null) return
    const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23]
    let step = 0
    const tick = (): void => {
      const frequency = notes[step % notes.length]
      if (frequency !== undefined && this.enabled) {
        const osc = context.createOscillator()
        const gain = context.createGain()
        osc.type = "triangle"
        osc.frequency.value = frequency / 2
        gain.gain.setValueAtTime(0.0001, context.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.5, context.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
        osc.connect(gain)
        gain.connect(music)
        osc.start()
        osc.stop(context.currentTime + 0.3)
      }
      step += 1
    }
    tick()
    this.musicTimer = globalThis.setInterval(tick, 320)
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      globalThis.clearInterval(this.musicTimer)
      this.musicTimer = null
    }
  }

  dispose(): void {
    this.stopMusic()
    if (this.context !== null) void this.context.close()
    this.context = null
    this.master = null
    this.musicGain = null
  }

  private blip(
    at: number,
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gainValue: number,
  ): void {
    const context = this.context
    const master = this.master
    if (context === null || master === null) return
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration)
    gain.gain.setValueAtTime(gainValue, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
    osc.connect(gain)
    gain.connect(master)
    osc.start(at)
    osc.stop(at + duration + 0.02)
  }

  private sweep(at: number, from: number, to: number, duration: number, gainValue: number): void {
    this.blip(at, from, to, duration, "sawtooth", gainValue)
  }

  private arpeggio(
    at: number,
    frequencies: readonly number[],
    spacing: number,
    gainValue: number,
  ): void {
    frequencies.forEach((frequency, index) => {
      this.blip(at + index * spacing, frequency, frequency * 1.01, 0.24, "triangle", gainValue)
    })
  }

  private thud(at: number, gainValue: number): void {
    this.blip(at, 160, 60, 0.18, "sine", gainValue)
    this.noise(at, 0.12, 400, 0.16)
  }

  private noise(at: number, duration: number, cutoff: number, gainValue: number): void {
    const context = this.context
    const master = this.master
    if (context === null || master === null) return
    const frames = Math.floor(context.sampleRate * duration)
    const buffer = context.createBuffer(1, frames, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < frames; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / frames)
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.value = cutoff
    const gain = context.createGain()
    gain.gain.value = gainValue
    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    source.start(at)
  }
}
