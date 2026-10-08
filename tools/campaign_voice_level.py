"""Level the campaign voice clips (2026-10-08): ITU-R BS.1770 integrated loudness -> one target, peak-safe, MP3 out.

The owner, hearing the auditions: "they all sound right, but quentin sounded quieter than the rest". ElevenLabs
voices come out at their own levels, so every clip is measured and brought to one loudness instead of nudging one
speaker by ear. Runs inside Blender (its bundled numpy + `aud`, which decodes and encodes MP3); system Python here has
no numpy and there is no ffmpeg. tools/campaign_voice.mjs runs it; by hand:

    blender -b --factory-startup --python tools/campaign_voice_level.py -- job.json

job.json = { "target": -17.0, "ceiling": -1.5, "max_lim": 6.0, "measure_only": false, "items": [{ "id", "src", "dst" }] }
Prints one line per item: LVL {"id", "lufs", "peak", "gain", "lim", "out_lufs", "out_peak", "passes", "secs"} (dB / LUFS).

-17 LUFS: the ship AI's 39 clips measure median -14.9 (both play through audio.sfxBus at ~0.9-0.95), the raw voices
-16.8 (Cybertronic) / ~-21 (Victor, Grainger, Joe) / -30 to -32 (Quentin). Two dB under the ship AI keeps the dynamic
voices (Grainger peaks 20 dB over his loudness) to a few dB of limiting.
The measured result is the truth, not the arithmetic: the MP3 round trip reads ~0.45 dB low and limiting costs
loudness, so each clip is re-measured after encoding and corrected (up to 4 passes, within 0.25 dB). `max_lim` caps the
limiter's depth; a clip that would need more stays short of the target and says so (`short`).

K-weighting = BS.1770's two stages as RBJ biquads at the clip's own rate (pyloudnorm's construction): a +4 dB high
shelf at 1.5 kHz, then a 38 Hz high-pass. 400 ms blocks every 100 ms, absolute gate -70 LUFS, relative gate -10 LU.
The gain is plain (dynamics untouched); only if it would push a peak past the ceiling does a look-ahead limiter take
the excess (5 ms look-ahead, 50 ms hold), so a quiet voice reaches the target instead of stopping short.
"""
import sys, json, math
import numpy as np
import aud


def _biquads(fs):
    G, Q, fc = 4.0, 1.0 / math.sqrt(2.0), 1500.0
    A = 10.0 ** (G / 40.0); w0 = 2.0 * math.pi * fc / fs; al = math.sin(w0) / (2.0 * Q); c = math.cos(w0); sA = math.sqrt(A)
    shelf = ([A * ((A + 1) + (A - 1) * c + 2 * sA * al), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - 2 * sA * al)],
             [(A + 1) - (A - 1) * c + 2 * sA * al, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - 2 * sA * al])
    Q, fc = 0.5, 38.0
    w0 = 2.0 * math.pi * fc / fs; al = math.sin(w0) / (2.0 * Q); c = math.cos(w0)
    hp = ([(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al])
    return shelf, hp


def _loudness(sound, fs):
    (b1, a1), (b2, a2) = _biquads(fs)
    y = np.asarray(sound.filter(b1, a1).filter(b2, a2).data(), dtype=np.float64)
    if y.ndim == 1:
        y = y[:, None]
    p = (y * y).sum(axis=1)            # mono / L+R: channel weights 1
    n, blk, hop = len(p), int(round(0.4 * fs)), int(round(0.1 * fs))
    if n < blk:                        # shorter than one block: the whole clip is the block
        z = np.array([p.mean()])
    else:
        c = np.concatenate(([0.0], np.cumsum(p)))
        starts = np.arange(0, n - blk + 1, hop)
        z = (c[starts + blk] - c[starts]) / blk
    lk = -0.691 + 10.0 * np.log10(np.maximum(z, 1e-12))
    z1 = z[lk > -70.0]
    if not len(z1):
        return -70.0
    rel = -0.691 + 10.0 * np.log10(z1.mean()) - 10.0
    z2 = z[(lk > -70.0) & (lk > rel)]
    return float(-0.691 + 10.0 * np.log10(max(z2.mean() if len(z2) else z1.mean(), 1e-12)))


def _limit(x, ceiling, fs):
    """Gain <= ceiling / |x| at every sample: a forward min over (hold + look-ahead), then a look-ahead box average.
    At a peak p the averaged window only holds values whose min-window contained p, so the gain there is <= its need."""
    env = np.abs(x).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    la, hold = max(1, int(0.005 * fs)), max(1, int(0.050 * fs))
    padded = np.concatenate((np.ones(hold - 1), need, np.ones(la - 1)))
    g1 = np.lib.stride_tricks.sliding_window_view(padded, hold + la - 1).min(axis=1)
    c = np.concatenate(([0.0], np.cumsum(np.concatenate((np.ones(la - 1), g1)))))
    g2 = (c[la:] - c[:-la]) / la
    return x * g2[:len(x), None]


def _render(x, gain_db, ceiling, fs, dst):
    y = x * (10.0 ** (gain_db / 20.0))
    lim = float(np.abs(y).max()) > ceiling
    if lim:
        y = _limit(y, ceiling, fs)
    y = np.clip(y, -1.0, 1.0).astype(np.float32)
    aud.Sound.buffer(y, fs).write(dst, int(fs), y.shape[1], aud.FORMAT_S16, aud.CONTAINER_MP3, aud.CODEC_MP3, 128000)
    chk = aud.Sound(dst).cache()
    cx = np.asarray(chk.data(), dtype=np.float64)
    return lim, _loudness(chk, chk.specs[0]), 20 * math.log10(max(float(np.abs(cx).max()), 1e-9))


def main():
    job = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8'))
    target, ceiling_db = float(job.get('target', -17.0)), float(job.get('ceiling', -1.5))
    max_lim = float(job.get('max_lim', 6.0))
    ceiling = 10.0 ** (ceiling_db / 20.0)
    for it in job['items']:
        try:
            snd = aud.Sound(it['src']).cache()
            fs = snd.specs[0]
            x = np.asarray(snd.data(), dtype=np.float64)
            if x.ndim == 1:
                x = x[:, None]
            lufs = _loudness(snd, fs)
            peak = float(np.abs(x).max()) if len(x) else 0.0
            peak_db = 20 * math.log10(max(peak, 1e-9))
            out = {'id': it['id'], 'lufs': round(lufs, 2), 'peak': round(peak_db, 2), 'secs': round(len(x) / fs, 2)}
            if not job.get('measure_only'):
                gmax = ceiling_db + max_lim - peak_db      # the most gain the limiter may absorb
                gain = min(target - lufs, gmax)
                for passes in range(1, 5):
                    lim, ol, op = _render(x, gain, ceiling, fs, it['dst'])
                    if abs(target - ol) <= 0.25 or gain >= gmax - 1e-6:
                        break
                    gain = min(gain + (target - ol), gmax)
                out.update({'gain': round(gain, 2), 'lim': lim, 'out_lufs': round(ol, 2), 'out_peak': round(op, 2), 'passes': passes})
                if target - ol > 0.25:
                    out['short'] = round(target - ol, 2)
            print('LVL ' + json.dumps(out), flush=True)
        except Exception as e:
            print('LVL ' + json.dumps({'id': it.get('id'), 'error': repr(e)}), flush=True)


main()
