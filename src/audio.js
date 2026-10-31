// Tiny WebAudio chiptune bus. Notes, mix and effect patterns live in
// src/data/audio.js.
import { AUDIO, BASS, CHORDS, MELODY, SFX } from './data/audio.js';

export class AudioBus {
  constructor({ enabled = true, music = true } = {}) {
    this.ctx = null;
    this.enabled = enabled;
    this.musicEnabled = music;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.step = 0;
    this.nextTime = 0;
    this.sfxLast = {};
    this.backgrounded = false;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = AUDIO.MASTER_GAIN;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = AUDIO.MUSIC_GAIN;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = AUDIO.SFX_GAIN;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended' && !this.backgrounded) this.ctx.resume();
    this.syncMusic();
  }

  pause() {
    this.backgrounded = true;
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (!this.backgrounded) return;
    this.backgrounded = false;
    if (!this.ctx) return;
    this.ctx.resume().catch(() => {});
    // Suspension freezes currentTime; restart the melody from now instead of
    // firing every beat that was scheduled while hidden.
    this.nextTime = this.ctx.currentTime + AUDIO.MUSIC_START_DELAY;
    this.syncMusic();
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (!this.enabled) {
      this.syncMusic();
    } else {
      this.unlock();
      this.syncMusic();
    }
  }

  setMusic(v) {
    this.musicEnabled = !!v;
    this.syncMusic();
  }

  syncMusic() {
    const want = this.enabled && this.musicEnabled && this.ctx && !this.backgrounded;
    if (want && !this.musicTimer) {
      this.nextTime = this.ctx.currentTime + AUDIO.MUSIC_START_DELAY;
      this.musicTimer = setInterval(() => this.schedule(), AUDIO.SCHEDULE_INTERVAL_MS);
    } else if (!want && this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  schedule() {
    if (!this.ctx) return;
    while (this.nextTime < this.ctx.currentTime + AUDIO.SCHEDULE_AHEAD) {
      const idx = this.step % MELODY.length;
      const note = MELODY[idx];
      if (note) this.tone(note, AUDIO.STEP * AUDIO.MELODY_DUR, 'square', AUDIO.MELODY_VOL, this.nextTime, this.musicGain);
      if (idx % 4 === 0) {
        const bar = idx / 4;
        this.tone(BASS[bar % BASS.length], AUDIO.STEP * AUDIO.BASS_DUR, 'triangle', AUDIO.BASS_VOL, this.nextTime, this.musicGain);
        const chord = CHORDS[bar % CHORDS.length];
        chord.forEach((freq, i) => {
          this.tone(
            freq,
            AUDIO.STEP * AUDIO.CHORD_DUR,
            'sine',
            AUDIO.CHORD_VOL,
            this.nextTime + i * AUDIO.CHORD_STRUM,
            this.musicGain,
          );
        });
      }
      this.nextTime += AUDIO.STEP;
      this.step++;
    }
  }

  tone(freq, dur, type = 'square', vol = 0.2, when = 0, bus = null) {
    if (!this.ctx || !this.enabled) return;
    const t = Math.max(this.ctx.currentTime + 0.001, when || this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + AUDIO.NOTE_ATTACK);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(bus || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + AUDIO.NOTE_STOP_PAD);
  }

  slide(f0, f1, dur, type = 'square', vol = 0.2) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(AUDIO.SLIDE_MIN_HZ, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    const sfx = SFX[name];
    if (!sfx) return;
    if (sfx.cooldown) {
      const now = performance.now();
      if (now - (this.sfxLast[name] || 0) < sfx.cooldown) return;
      this.sfxLast[name] = now;
    }
    const t0 = this.ctx.currentTime;
    if (sfx.slide) {
      const { from, to, dur, type, vol } = sfx.slide;
      this.slide(from, to, dur, type, vol);
      return;
    }
    const step = sfx.step || 0;
    (sfx.notes || []).forEach((n, i) => {
      const when = t0 + (n.delay ?? i * step);
      this.tone(n.freq, n.dur, n.type, n.vol, when);
    });
  }
}
