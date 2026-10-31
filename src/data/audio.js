// Audio mix, chiptune notes and sound-effect patterns.

export const AUDIO = {
  MASTER_GAIN: 0.65,
  MUSIC_GAIN: 0.07,
  SFX_GAIN: 0.18,
  SCHEDULE_INTERVAL_MS: 220,
  SCHEDULE_AHEAD: 0.7,
  MUSIC_START_DELAY: 0.15,
  STEP: 0.235,
  MELODY_DUR: 0.7,
  MELODY_VOL: 0.12,
  BASS_DUR: 2.2,
  BASS_VOL: 0.24,
  CHORD_DUR: 3.8,
  CHORD_VOL: 0.045,
  CHORD_STRUM: 0.012,
  NOTE_ATTACK: 0.012,
  NOTE_STOP_PAD: 0.02,
  SLIDE_MIN_HZ: 20,
};

// 32 steps = two 4-bar phrases. The second phrase lifts the B section so the
// loop does not feel like a 15-second ringtone on repeat.
export const MELODY = [
  523.25, null, 659.25, 783.99, 659.25, null, 523.25, 587.33,
  659.25, null, 880.0, 783.99, 659.25, 587.33, 523.25, null,
  587.33, null, 698.46, 880.0, 783.99, null, 659.25, 587.33,
  523.25, 587.33, 659.25, null, 1046.5, null, 783.99, null,
];

export const BASS = [130.81, 110.0, 87.31, 98.0, 130.81, 110.0, 87.31, 98.0];

// C - Am - F - G, voiced in the mid register as a soft pad under the pluck.
export const CHORDS = [
  [329.63, 392.0, 523.25],
  [261.63, 329.63, 440.0],
  [349.23, 440.0, 523.25],
  [392.0, 493.88, 587.33],
];

export const SFX = {
  click: {
    notes: [{ freq: 392, dur: 0.045, type: 'square', vol: 0.1 }],
  },
  place: {
    notes: [
      { freq: 523.25, dur: 0.06, type: 'square', vol: 0.16 },
      { freq: 783.99, dur: 0.09, type: 'square', vol: 0.13, delay: 0.055 },
    ],
  },
  demolish: {
    slide: { from: 220, to: 70, dur: 0.16, type: 'sawtooth', vol: 0.24 },
  },
  error: {
    notes: [
      { freq: 150, dur: 0.08, type: 'square', vol: 0.2 },
      { freq: 110, dur: 0.11, type: 'square', vol: 0.18, delay: 0.07 },
    ],
  },
  coin: {
    cooldown: 420,
    notes: [
      { freq: 1046.5, dur: 0.055, type: 'square', vol: 0.12 },
      { freq: 1568, dur: 0.09, type: 'square', vol: 0.09, delay: 0.045 },
    ],
  },
  harvest: {
    cooldown: 380,
    notes: [{ freq: 660, dur: 0.05, type: 'triangle', vol: 0.14 }],
  },
  mission: {
    step: 0.09,
    notes: [
      { freq: 523.25, dur: 0.12, type: 'square', vol: 0.14 },
      { freq: 659.25, dur: 0.12, type: 'square', vol: 0.14 },
      { freq: 783.99, dur: 0.12, type: 'square', vol: 0.14 },
      { freq: 1046.5, dur: 0.12, type: 'square', vol: 0.14 },
    ],
  },
};
