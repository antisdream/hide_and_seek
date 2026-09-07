import type { GameEffect, GameSnapshot } from "../../shared/game-types";

// 외부 녹음·샘플·AI 음원 없이 이 프로젝트에서 정한 음높이와 Web Audio 발진기만 사용한다.
const MELODY = [62, 69, 65, 0, 74, 72, 69, 0, 65, 67, 62, 0, 69, 65, 60, 0];

/** 사용자가 켜기 전에는 AudioContext나 타이머를 만들지 않는다. 서버 통신은 없다. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private phase?: GameSnapshot["phase"];
  private enabled = false;
  private destroyed = false;
  private step = 0;
  private urgent = false;

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (this.destroyed) return false;
    if (!enabled) {
      this.enabled = false;
      if (this.master) this.master.gain.value = 0;
      this.stopTimer();
      await this.context?.suspend();
      return false;
    }
    if (typeof window.AudioContext !== "function") return false;
    this.context ??= new window.AudioContext();
    if (!this.master) {
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      document.addEventListener("visibilitychange", this.visibilityChanged);
    }
    await this.context.resume();
    if (this.destroyed) return false;
    this.enabled = this.context.state === "running";
    this.master.gain.value = this.enabled ? 0.12 : 0;
    if (this.enabled) this.startTimer();
    return this.enabled;
  }

  snapshot(snapshot?: GameSnapshot): void {
    if (this.phase !== snapshot?.phase) {
      this.phase = snapshot?.phase;
      this.step = 0;
      if (this.phase === "SEEKING") this.chime([62, 69, 74]);
      if (this.phase === "RESULT" || this.phase === "FINAL") this.chime([65, 69, 74, 77]);
    }
    this.urgent = snapshot?.phase === "SEEKING" && snapshot.phaseEndsAt - snapshot.serverTime <= 15_000;
  }

  effect(effect: GameEffect): void {
    const notes: Partial<Record<GameEffect["type"], number[]>> = {
      "correct-tag": [74, 81, 86], "wrong-tag": [50, 46], "focus-empty": [46, 41],
      swap: [69, 81, 74], portal: [62, 74], mission: [72, 76, 79], taunt: [81, 77, 81],
    };
    if (notes[effect.type]) this.chime(notes[effect.type]!);
  }

  destroy(): void {
    this.destroyed = true;
    this.enabled = false;
    this.stopTimer();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    void this.context?.close().catch(() => undefined);
  }

  private visibilityChanged = (): void => {
    if (document.hidden) {
      this.stopTimer();
      void this.context?.suspend().catch(() => undefined);
    } else if (this.enabled) {
      void this.context?.resume().then(() => this.startTimer()).catch(() => undefined);
    }
  };

  private startTimer(): void {
    if (this.timer || document.hidden || !this.enabled || this.destroyed || this.context?.state !== "running") return;
    this.timer = setInterval(() => {
      if (!this.phase || this.phase === "LOBBY" || this.phase === "FINAL") return;
      const note = MELODY[this.step++ % MELODY.length];
      if (note) this.tone(note + (this.urgent ? 12 : 0), 0, 0.22, 0.12);
      if (this.urgent && this.step % 2 === 0) this.tone(38, 0, 0.08, 0.2);
    }, 360);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private chime(notes: number[]): void {
    notes.forEach((note, index) => this.tone(note, index * 0.075, 0.18, 0.3));
  }

  private tone(note: number, delay: number, duration: number, volume: number): void {
    if (!this.enabled || !this.context || !this.master || this.context.state !== "running" || document.hidden) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    const start = this.context.currentTime + delay;
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }
}
