/**
 * Latency calibration math ("hit along to the click"). Pure functions, no DOM or Web Audio, so everything
 * here is unit tested headlessly.
 *
 * SIGN CONVENTION (matches AppSettings.inputLatencyMs and Judge.latencyMs):
 *   error = hit time - click time (ms). Positive = the hit was stamped LATE.
 *   inputLatencyMs = median error. The judge computes `songTime*1000 - inputLatencyMs`, so a positive offset
 *   moves every hit EARLIER, which cancels a constant lateness.
 *
 * CLOCK MAPPING (done by CalibrationSection, helpers here):
 *   Clicks are scheduled at AudioContext times (render clock, ctx.currentTime). Hits carry performance.now()
 *   timestamps (pointer events, key events and Web MIDI all use that clock). We sample pairs
 *   (ctx.currentTime, performance.now()) in the same synchronous block, several times, and take
 *   offset = min(perf - ctx*1000). currentTime advances in render quanta (about 3 ms), so each pair overestimates
 *   by 0 to one quantum; the minimum over many samples is the least biased. We deliberately use the RENDER clock,
 *   not getOutputTimestamp(): Play measures song time as currentTime - outputLatency, so the measured value is the
 *   combined input + output latency that Play needs, and that is what gets applied (see offsetToApply).
 */

/** Same as the settings store range for inputLatencyMs / outputLatencyMs. */
export const LATENCY_LIMIT_MS = 500;
export const CAL_BPM = 90;
export const CAL_CLICKS = 16;
/** Hits paired to a click with an index below this are warm-up and ignored (by click index, not by hit count). */
export const CAL_SKIP_FIRST = 4;
/** Hard limit: a hit further than this from its nearest click is never a real attempt (Bluetooth can be 300 ms late). */
export const CAL_MAX_ERROR_MS = 400;
/** Second hard limit, measured from the first-pass median: a hit further than this from the typical hit is not an attempt. */
export const CAL_MAX_DEVIATION_MS = 250;
/** Outlier cut in units of the median absolute deviation. */
export const CAL_MAD_K = 2;
/** The MAD is floored so a very tight cluster does not throw away normal hits. */
export const CAL_MAD_FLOOR_MS = 10;
/** Minimum usable hits for a result at all. */
export const CAL_MIN_USED = 6;
/** Standard deviation (ms) up to which the result is called good. */
export const CAL_GOOD_SD_MS = 25;

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

export function stdDev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Median absolute deviation (unscaled). */
export function mad(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Click times (ctx seconds): `count` clicks from `startCtxSec`, accent on beat 1 of every 4. */
export function clickSchedule(startCtxSec: number, bpm = CAL_BPM, count = CAL_CLICKS): { time: number; accent: boolean }[] {
  const beat = 60 / bpm;
  return Array.from({ length: count }, (_, i) => ({ time: startCtxSec + i * beat, accent: i % 4 === 0 }));
}

/** (ctx.currentTime seconds, performance.now() ms) read together. */
export interface ClockPair {
  ctxSec: number;
  perfMs: number;
}

/** perf-ms minus ctx-ms; minimum over samples (least biased by render-quantum rounding). NaN when empty. */
export function estimateClockOffsetMs(pairs: readonly ClockPair[]): number {
  let best = Infinity;
  for (const p of pairs) best = Math.min(best, p.perfMs - p.ctxSec * 1000);
  return Number.isFinite(best) ? best : NaN;
}

export interface HitError {
  /** Hit time on the audio clock (ms). */
  hitCtxMs: number;
  clickIndex: number;
  /** hit minus click (ms); positive = late. */
  errorMs: number;
}

/**
 * Maps hits (performance.now ms) to the audio clock and pairs each with its nearest click. When several hits
 * land on the same click only the closest one is kept (double taps and flams are not a second attempt).
 * Returned in time order.
 */
export function pairHits(hitPerfMs: readonly number[], clickCtxSec: readonly number[], clockOffsetMs: number): HitError[] {
  if (!clickCtxSec.length || !Number.isFinite(clockOffsetMs)) return [];
  const bestByClick = new Map<number, HitError>();
  for (const hp of hitPerfMs) {
    if (!Number.isFinite(hp)) continue;
    const hitCtxMs = hp - clockOffsetMs;
    let ci = 0;
    let ce = Infinity;
    for (let i = 0; i < clickCtxSec.length; i++) {
      const e = hitCtxMs - clickCtxSec[i]! * 1000;
      if (Math.abs(e) < Math.abs(ce)) {
        ce = e;
        ci = i;
      }
    }
    const cur = bestByClick.get(ci);
    if (!cur || Math.abs(ce) < Math.abs(cur.errorMs)) bestByClick.set(ci, { hitCtxMs, clickIndex: ci, errorMs: ce });
  }
  return [...bestByClick.values()].sort((a, b) => a.hitCtxMs - b.hitCtxMs);
}

export type Verdict = "good" | "noisy" | "too-few";

export interface CalibrationResult {
  verdict: Verdict;
  /** Hits received / hits actually used. */
  received: number;
  used: number;
  /** Signed errors that were used, in time order (ms). */
  errors: number[];
  meanMs: number;
  medianMs: number;
  /** Standard deviation of the used errors (ms). */
  spreadMs: number;
  /** The measured combined latency to apply: the median, rounded to 1 ms. NaN when too-few. */
  offsetMs: number;
  message: string;
}

/**
 * Turns paired hits into a verdict. Hits paired to clicks with index < `skip` (warm-up) are dropped first, then
 * the hard limit, then outliers around a first-pass median (so a consistently late user still calibrates).
 */
export function analyzeHits(paired: readonly HitError[], skip = CAL_SKIP_FIRST): CalibrationResult {
  const received = paired.length;
  const afterSkip = paired.filter((h) => h.clickIndex >= skip).map((h) => h.errorMs);
  const capped = afterSkip.filter((e) => Math.abs(e) <= CAL_MAX_ERROR_MS);
  let inRange = capped;
  if (capped.length >= 3) {
    const m0 = median(capped);
    inRange = capped.filter((e) => Math.abs(e - m0) <= CAL_MAX_DEVIATION_MS);
  }
  let used = inRange;
  if (inRange.length >= 3) {
    const m = median(inRange);
    const cut = CAL_MAD_K * Math.max(mad(inRange), CAL_MAD_FLOOR_MS);
    used = inRange.filter((e) => Math.abs(e - m) <= cut);
  }
  if (used.length < CAL_MIN_USED) {
    return {
      verdict: "too-few",
      received,
      used: used.length,
      errors: used,
      meanMs: used.length ? mean(used) : NaN,
      medianMs: used.length ? median(used) : NaN,
      spreadMs: stdDev(used),
      offsetMs: NaN,
      message: `Only ${used.length} usable hits (need ${CAL_MIN_USED}). Hit along with every click and try again.`,
    };
  }
  const spread = stdDev(used);
  const good = spread <= CAL_GOOD_SD_MS;
  const med = median(used);
  return {
    verdict: good ? "good" : "noisy",
    received,
    used: used.length,
    errors: used,
    meanMs: mean(used),
    medianMs: med,
    spreadMs: spread,
    offsetMs: Math.round(med),
    message: good ? "Steady hitting: this result is trustworthy." : "Your hits were uneven, so the result is uncertain. Try again, ideally twice, and compare.",
  };
}

/** Full pipeline: clock offset + hits + clicks to result. */
export function calibrate(hitPerfMs: readonly number[], clickCtxSec: readonly number[], clockOffsetMs: number): CalibrationResult {
  return analyzeHits(pairHits(hitPerfMs, clickCtxSec, clockOffsetMs));
}

/**
 * The wizard measures the COMBINED delay (audio output + input) relative to the render clock. Play already
 * subtracts outputLatencyMs from song time, so only the remainder belongs in inputLatencyMs.
 * With outputLatencyMs = 0 (the default) this equals the measured value.
 */
export function offsetToApply(measuredMs: number, currentOutputLatencyMs: number): number {
  return Math.round(measuredMs - currentOutputLatencyMs);
}

/**
 * Output tuner moved to `newOutputMs`: returns the pair (input, output) after the move. Play subtracts
 * outputLatencyMs from song time and the judge subtracts inputLatencyMs, so the effective compensation is
 * input + output. Moving output by D moves input by -D to keep that sum (and so the judged timing of a
 * fixed player) unchanged. D is limited so neither value leaves +-limitMs, which keeps the sum exact.
 */
export function retuneOutput(inputMs: number, outputMs: number, newOutputMs: number, limitMs = LATENCY_LIMIT_MS): { inputLatencyMs: number; outputLatencyMs: number } {
  let d = newOutputMs - outputMs;
  d = Math.min(d, limitMs - outputMs, inputMs + limitMs);
  d = Math.max(d, -limitMs - outputMs, inputMs - limitMs);
  return { inputLatencyMs: inputMs - d, outputLatencyMs: outputMs + d };
}

/** Checks a value `offsetToApply` produced against the range the settings store accepts. */
export function applyProblem(offsetMs: number, limitMs = LATENCY_LIMIT_MS): string | null {
  if (!Number.isFinite(offsetMs)) return "There is no usable result to apply.";
  if (Math.abs(offsetMs) > limitMs) {
    return `The result (${offsetMs} ms) is outside the supported range of +-${limitMs} ms, so it was not applied. Check the output device and try again.`;
  }
  return null;
}
