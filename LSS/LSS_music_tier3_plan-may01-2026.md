# LSS Tier 3 Reactive Band Plan (v8_1VR)

Goal: a procedural in-game band that scores the match in real time. Drums set the pulse, bass anchors the harmony, pad holds the room, lead reacts to the player. No samples, no streamed audio, all Web Audio synthesis. Lifted (and trimmed) from `framework_dancing_cosmos_band.html`.

This file is the design doc; the code lives in `last_ship_sailing_v8_1VR.html` once we fork.

## 0. First principles (read this before touching code)

Order of priority, top-down. Earlier rules outrank later ones; if a fancy reactive feature would compromise rule 1, drop the feature.

1. **A steady beat is the most important part.** The kick + hat must be rock-solid before anything else gets layered. If the scheduler ever skips, drops, or jitters a beat, the whole illusion dies. Step 1 of the build order is a clock that ticks reliably under combat load. We test the metronome alone for as long as it takes to trust it.

2. **Rhythms are built on beats.** Snare, bass-line variation, lead phrases, all of them are scheduled relative to the beat counter, never to wall-clock time. A pattern is a list of `(beatOffset, voice, note)` tuples. The scheduler reads them; nothing is fired with `setTimeout` from gameplay code. This means kills, doomed-state entry, etc. can *queue* a phrase but the phrase only plays on the next beat (or the next musically-correct subdivision).

3. **Chords have to fit together.** Voice leading: pad chord changes move the smallest distance possible. A chord progression is a list of `(degree, quality, bars)` tuples and the pad picks the closest voicing to the previous chord. Bass roots align to the pad. Lead is constrained to chord-tones on strong beats and scale-tones on weak beats. No accidentals unless we explicitly want a sting.

4. **Chords are tuned to important frequencies in the game.** This is the LSS-specific piece. The game already emits sounds at characteristic frequencies (the cluster hum, the engine drone, the impact transient pitch, etc). Pick the match key so the pad's tonic sits inside the same harmonic series as the loudest sustained game sound. First pass: pick A as the default (440 Hz family) because the existing ambient drone is already in that neighborhood; verify by scoping `audio.ambientGain` output spectrum once we instrument it. Phrygian mode (b2) gives the unease that fits the cluster sound. If a sound effect has a strong tonal center (e.g. the warning tone before a doomed-state pop), we tune the pad's chord at that moment to share the root or fifth so the warning tone *is* part of the music, not on top of it.

This is the LSS aesthetic: music isn't a backdrop, it's the resonance of the arena. Beat is the heartbeat, chords are the room's standing wave, lead is the player's voice.

## 1. Why Tier 3 (and not Tier 2)

Tier 2 would just give us "a drum loop during fights". Tier 3 is the version where the music *follows the round*: tempo creeps up as the timer drains, lead trills on a kill, pad slumps to minor when you're doomed, drums cut out inside a stasis field. The player feels the round through the soundtrack. This is what the dancing cosmos band already knows how to do for an external mic input; we just feed it gameplay events instead of audio.

## 2. Audio bus integration

Existing v8VR bus:

    audio.ctx
      ├─ audio.masterGain (0.85 * userVol.master)
      │    └─ audio.masterComp (-14, 3:1)
      │         └─ audio.hiCut (lowpass 3500 Hz)
      │              └─ destination
      └─ audio.ambientGain (ducked by `v8DuckAmbient`)
           └─ audio.hiCut

Add a parallel `audio.musicBus` so the band sits next to ambient, both downstream of the master limiter chain:

    audio.musicGain (user music volume slider, 0..1, default 0.55)
      └─ audio.musicComp (gentler glue: -10, 2.5:1, slow release)
           └─ audio.hiCut (existing)

Why parallel and not through `sfxBus`: gunfights already saturate sfxBus and the voice budget would skip drum hits. Music must be reliable.

The existing `v8DuckAmbient` will be extended into `v8DuckBus(targetGainNode, amount, attack, release)` so the same shape ducks both ambient and music together when a hit lands. Music ducks less than ambient (0.6x of ambient duck amount) so beats stay legible through hits.

## 3. Synth functions to lift verbatim

Copy these four from `framework_dancing_cosmos_band.html` (lines 2109-2233) into a new `// === LSS BAND === //` section:

    _synthDrum(note, g, when, out)
    _synthBass(freq, g, when, out)
    _synthPad(freq, g, when, out)
    _synthLead(freq, g, when, out)

Drum mapping (GM-ish, kept identical so the lab file and game share recipes):
- 35, 36 : kick (sine 150→45 Hz exp ramp, 0.28s decay)
- 38, 40 : snare (bandpass 1800 Hz noise, 0.15s decay)
- 49, 57 : crash (highpass 5000 Hz noise, 1.2s decay)
- default : hat (highpass 7000 Hz noise, 0.06s decay)

Bass: sawtooth + lowpass 450 Hz Q=1, fast attack 8ms.
Pad: detuned dual sawtooth (1.005x), lowpass 1400 Hz Q=0.7, slow 0.35s attack.
Lead: triangle, fast attack 15ms, decay-to-sustain at 0.14g over 0.12s.

Each returns `{ stop(t) }` for note-off. Output node arg `out` will be `audio.musicGain` (not `audio.ctx.destination`), the only edit needed.

## 4. The scheduler

A small lookahead clock, classic Web Audio pattern:

    musicState = {
      enabled: true,
      ctx: audio.ctx,
      out: audio.musicGain,
      bpm: 96,                  // current target
      bpmTarget: 96,            // smoothed toward this
      beat: 0,                  // global beat counter (monotonic)
      nextBeatAt: 0,            // ctx.currentTime of next scheduled beat
      lookaheadSec: 0.18,       // schedule this far ahead
      tickIntervalMs: 50,       // how often the scheduler wakes up
      keyRoot: 9,               // A by default (semitone above C0)
      mode: 'minor',            // 'minor' | 'major' | 'phrygian'
      bar: 0,
      patternId: 'menu',
      activeNotes: [],          // for cleanup
      lastKillBeat: -999,       // for kill-streak phrasing
      multikillCount: 0,
    }

`musicTick()` runs on `setInterval` at 50ms. Each wake:
1. Smooth `bpm` toward `bpmTarget` (one-pole, 0.05 alpha).
2. While `nextBeatAt < ctx.currentTime + lookaheadSec`: schedule the events for that beat, increment `beat`, advance `nextBeatAt += 60/bpm`.
3. Every 4 beats: increment `bar`, check pattern transitions.

This replaces all the autocorrelation / softmax tempo lock from the band file. The game *is* the source of tempo; we don't have to listen for it.

## 5. Patterns by game state

`MUSIC_PATTERNS` is a table keyed by game state (lobby, warmup, combat, doomed, roundEnd, matchEnd) plus an intensity tier 0..3.

### lobby (the title / room screen)
- bpm 78
- mode: minor
- drums: hat on every 8th, kick on 1, soft snare on 3, crash on bar 1 only
- bass: root note on 1 and 3, octave drop on bar 4
- pad: i (tonic minor) for 8 bars, then VI for 4, back to i (i-VI-i-i-VI-i-i-i loop, modal)
- lead: silent (lobby is breathing room)
- music gain duck: -3 dB while announcer speaks

### warmup (countdown to round start)
- bpm 88, ramping linearly to 100 across the 5s countdown
- drums: kick + hat eighths, snare on 2 and 4, no crash
- bass: dotted-eighth ostinato on root
- pad: i held
- lead: rising arpeggio i-III-V-VII on the last 1.5s (pickup into round)

### combat (round playing, normal pace)
- bpm 100 (intensity 1), 116 (int 2), 132 (int 3)
- bpm continuously rises by `(roundDuration - timeLeft) / roundDuration * 32` BPM over the round (96→128 typical)
- drums: kick on 1+3, snare on 2+4, hat 16ths
- bass: 8th-note pulse alternating root / fifth, walking down on bar 4
- pad: i for 4 bars, VI for 2, VII for 2, back to i (Aeolian loop)
- lead: silent baseline; only triggers on kills (see hooks)

Intensity is `f(playerCount, killsThisRound, doomedCount)`. More chaos = higher intensity.

### doomed (player has minimal health and is one hit from out)
- Layer over combat: switch pad to a drone on the b2 (Phrygian flat-2), no chord changes
- drums lose the snare (just kick + hat)
- bass switches to a single low pedal on root, modulated by sub-LFO at 0.4 Hz (the "tunnel") for a queasy feel
- bpm holds steady (doesn't ramp)

### roundEnd
- bpm 84
- drums: crash on 1, snare ruff (3 fast hits), then silence
- bass: held root, half note
- pad: ONE chord shift then hold
  - victory: I major (Picardy third, lifts the mode from minor to major)
  - defeat: i-iv-i descending (sigh)
- lead: short ascending phrase (victory) or descending phrase (defeat), 4 notes, scale-correct

### matchEnd
- bpm 76
- drums: silent
- bass: long sustain on root
- pad: I-V-I (victory) or i-VII-VI-V (defeat ostinato that sits unresolved)
- lead: silent
- crossfade out over 4 bars when returning to lobby

## 6. Reactive hooks (what events do what)

These are the calls the game makes into the music engine. Each is a one-liner the game side adds at the existing event sites.

### Round timer urgency
- At round start: `music.setPattern('combat', { intensity: 1 })`
- Every game tick: `music.setBpmTarget(96 + (1 - timeLeft/roundDuration) * 32)`
- At `timeLeft < 30s`: bump intensity to 2 (adds the snare ruff variant on the bar pickup)
- At `timeLeft < 10s`: bump intensity to 3, drums double-time (16th kicks)
- At `timeLeft <= 5s`: schedule the rising arpeggio lead phrase ending exactly on `timeLeft = 0`

### Kills
- On player kill: `music.onKill('player')`
  - First kill in 2s: lead plays 1 note (root or fifth, beat-quantized to next 8th)
  - Second kill within 2s: lead plays 2 ascending notes
  - Third within 2s: 3-note arpeggio (multikill arpeggio)
  - 4+: full pentatonic run up an octave
- On bot kill: `music.onKill('bot')` (the player got killed)
  - Pad briefly bends down a semitone (0.5s) then back up (sour stab)
  - Drums skip the next snare (a beat of doubt)

### Doomed state entry / exit
- On `enterDoomed()`: `music.enterMode('doomed')`
- On `exitDoomed()`: `music.exitMode('doomed')` (back to combat at current intensity)

### Stasis field
- On `playerInsideStasis = true`: `music.suspendDrums(true)` (drums fade out over 0.3s, pad holds, bass holds)
- On exit: `music.suspendDrums(false)` (drums fade in over 0.5s)
- The silence-as-feature thing. Inside stasis, only pad + bass hum; the world goes dreamlike.

### Round transitions
- On `roundEnd(victor)`: `music.setPattern(victor === player.team ? 'roundEnd:victory' : 'roundEnd:defeat')`
- On `matchEnd(victor)`: `music.setPattern(victor === player.team ? 'matchEnd:victory' : 'matchEnd:defeat')`
- On `returnToLobby()`: `music.setPattern('lobby')` with a 1.5s crossfade.

### Camera shake / hit feedback (subtle)
- The existing chromatic + rumble chain already exists. Music adds a tiny duck on big hits: `v8DuckBus(audio.musicGain, 0.4, 0.05, 0.18)` so the snare/kick still rings through but ducks under the impact transient.

## 7. Key, scale, chord theory

We pick a key once per match (random from a small set):
- A minor (Aeolian)
- D minor
- E Phrygian (the LSS aesthetic mode, b2 gives the unease)
- F# minor

Scale degrees are stored as semitone offsets from `keyRoot`:
- Aeolian:  [0, 2, 3, 5, 7, 8, 10]
- Phrygian: [0, 1, 3, 5, 7, 8, 10]

Chord helper:

    function chordNotes(degree, quality) {
      // degree 0..6, quality 'min' | 'maj' | 'dim'
      const root = scale[degree];
      if (quality === 'min')  return [root, root+3, root+7];
      if (quality === 'maj')  return [root, root+4, root+7];
      if (quality === 'dim')  return [root, root+3, root+6];
    }

The pad plays chord-tones spread across 2 octaves above keyRoot+24 (3rd octave above middle C area). The bass plays the root only, octave below pad (keyRoot+12).

The lead picks notes from the scale, biased to chord-tones on strong beats.

## 8. Pentatonic for kill phrases

Minor pentatonic from `keyRoot`: [0, 3, 5, 7, 10]. Used for the multikill runs. The 6th position (12, 15, ...) wraps an octave up. Pentatonic over the chord changes never sounds wrong, which is why it's the default for reactive lead.

## 9. Settings UI

Add to the settings panel (where master volume already lives):

- `Music`: master toggle (on/off), default on
- `Music volume`: slider 0..1, default 0.55, persisted to `lss_settings`
- `Music intensity ceiling`: dropdown chill / normal / wild (caps intensity at 1, 2, 3 respectively)
- `Mute music in lobby`: checkbox, default off

These live on the same page as the existing audio settings. localStorage keys:
- `lss_settings.musicEnabled` (bool)
- `lss_settings.musicVolume` (float)
- `lss_settings.musicCeiling` ('chill'|'normal'|'wild')
- `lss_settings.musicMuteLobby` (bool)

## 10. Performance budget

- 4 voices max simultaneously (drum + bass + pad + lead). No polyphony in pad (one chord at a time, but each chord = 3 oscillators internally, so the real ceiling is 3 + 1 + 1 + 1 = 6 oscillators).
- Lookahead 180ms means we never schedule more than ~4 beats ahead even at 132 BPM.
- All voices route through a shared compressor before the master limiter, so we don't fight the existing voice budget.
- No mic input, no FFT, no autocorr; the dancing cosmos band's expensive analysis stays in its own file.

## 11. Things we are NOT lifting

- BPM detection / tempo lock (we know our own BPM)
- Chroma chord detection (we pick chords)
- Phrase arc / era selection (we have round states)
- MIDI output (game-internal only)
- The `_synthEnsure` master gain in the band file (we use our own bus)
- The `BAND._synthActive` map (we track active voices in `musicState.activeNotes` instead, with explicit cleanup on pattern change)

## 12. File structure inside v8_1VR

A single block, near the existing audio init code (search for `audio.masterComp`). Approximate size: 600-800 lines.

    // === LSS BAND v1 === (Tier 3 reactive music)
    // - musicState (config + runtime)
    // - _synthDrum, _synthBass, _synthPad, _synthLead (lifted from band file)
    // - chordNotes, scaleAt (theory helpers)
    // - musicTick (scheduler)
    // - musicSetPattern, musicSetBpmTarget, musicSetIntensity
    // - musicOnKill, musicEnterMode, musicExitMode, musicSuspendDrums
    // - musicSetEnabled, musicSetVolume (settings hooks)
    // - MUSIC_PATTERNS table

Hooks the game already has (where we'll insert one-line calls):
- `playerDie()` (search "player death" comment)
- bot kill handler (search "spawnGib" or "onBotDeath")
- `enterDoomed`, `exitDoomed` (already exist as state methods)
- stasis field collision (in `updateStasisFields`)
- round timer update loop (in main update)
- round end handler (search "roundEnd" or "endRound")

## 13. Build order

Aligned with the first principles in section 0: beat → rhythm → chords → chords tuned to game.

1. **The beat alone.** Lift `_synthDrum`, route to `audio.musicGain`. Build the scheduler skeleton. Schedule a kick on every beat at 100 BPM, nothing else. Run it in lobby for 60 seconds while the game is at idle and again during a hot combat scene. Verify zero jitter, zero drops. Don't move on until this is boring.
2. **Rhythm on the beat.** Add hat (16ths) and snare (2 + 4). Verify the rhythm survives heavy combat audio. This is still just drums.
3. **Chord changes that fit.** Add `_synthBass` and `_synthPad`. Implement voice-leading rule (pad picks closest voicing to previous chord). Hard-code an i-VI-VII-i loop in A minor. Listen for clicks, pumping, mud.
4. **Chords tuned to the game.** Instrument `audio.ambientGain`'s spectrum: capture the dominant peaks from the cluster hum, engine drone, doomed warning tone. Pick the match key so the pad's tonic + fifth sit on those peaks. Verify the music feels like it's emerging from the arena instead of layered over it.
5. Wire `setPattern('combat')` to round start. Test round-start to round-end transitions.
6. Wire BPM ramp to round timer. Test that the music speeds up.
7. Add `_synthLead` and the `onKill` pentatonic phrases. Quantize to next 8th note (rule 2). Test multikill arpeggios.
8. Wire doomed mode (Phrygian drone). Test entering / exiting low health.
9. Wire stasis suspend (drums fade out). Test field interaction.
10. Wire roundEnd / matchEnd victory + defeat phrases.
11. Add settings UI bindings, persistence.
12. Final mix pass: balance music vs sfx vs ambient. Music sits at roughly -8 dB under sfx so kills still pop above the band.

## 14. Open questions for later

- Should the lead respond to *which* enemy you killed (different note per team color)? Could be cute, could be overcomplicated.
- Should the pad respond to your ship's energy / cluster charge level? (Slow drift between two chord voicings as energy fills.)
- Should kills by bots affect the music (third-party schadenfreude)?
- Stretch goal: bot personalities have signature lead motifs that play when they get a kill.

These are after we have the basic loop working. Don't get distracted by them on first build.

## 15. v8_1VR fork delta from v8VR

Just the `// === LSS BAND v1 === //` section + ~6 hook lines + settings UI rows. Should be a clean diff. Version marker bumps to `v8_1VR` in the comment header and the `LSS_VERSION` constant if it exists.
