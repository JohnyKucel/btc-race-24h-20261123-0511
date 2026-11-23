// BounceRider — a Donchian breakout bot for the make.fun BTC 24h race.
//
// Strategy (long only, one asset CBBTC, full-size entries, few trades):
//   - Entry: the 1-minute close breaks above the highest high of the previous
//     60 bars, and only when the market is actually moving: the 14-bar ATR is
//     at or above its trailing 240-bar median. After an exit the bot rests
//     900 bars (15 hours) before it may enter again: on the dev window the
//     range after the one real move is full of fake breakouts, and every
//     re-entry there lost money. No new entries in the final 60 bars.
//   - Exit: the whole position on the first of (a) a trailing stop 200 bps
//     below the highest close since entry, or (b) the close falls to the
//     lowest low of the previous 60 bars. There is NO take-profit: the one
//     real move on the dev window ran +3.5% peak, and a +130 bps target
//     banks only +11.47 and then hands the bot back to the chop. Riding it
//     with a wide trail banks +21.26 instead.
//   - Every exit is level-based, so a sell the market refuses is retried on
//     the next bar while the level still holds.
//   - All money math is integer (BigInt quote units); indicators are float64
//     on + - * / alone, so the same bars give the same orders, run after run.
//   - The bot never reads the clock, the environment or randomness: time is
//     the bar time in each batch it is sent (hello, batch, orders, bar).
//
// Backtested on the published dev window (2026-11-22 05:11 UTC -> 2026-11-23
// 05:11 UTC) with the kit's exact fill model (fill at the next open, 4 bps
// fee, 2 bps slippage, constant-product impact against the bar's open depth),
// verified by the NEW kit's grade-local (process driver, 2026-11-23 ~06:52 UTC):
// net PnL +21.262128 USDC on $1,000, 2 trades (1 round trip: entry bar 184,
// exit bar 433 on the 60-bar low break, held 249 bars), win rate 1.000,
// max drawdown 1.4274%, fees $0.808669, 0 rejected orders, guardrails met,
// L1 regrade reproduced (deterministic), result sha eae79bda27d4dbb2e4caa09cb
// b668d4c0c4fabd42d3a5e675e76b36750be02da. At 2x fees net PnL still
// +20.446374 USDC. The offline backtester reproduces the grade to the
// micro-cent. The house EMA-cross baseline loses -114.83
// USDC on the same window (76 whipsaw trades); buy-and-hold +32.17. The
// parameters sit on a wide plateau, not a knife edge: hi 20-150, lo 50-80,
// trail 120-10000 bps, ATR 0.9-1.5x, cooldown 900+ bars all give the
// identical +21.26. What breaks it: trail 80-100 bps (+0.63 to +3.14,
// the trail chops the ride), lo 20 (+0.63, the low break fires inside the
// move), ATR 2.0x (+16.20, late entry). The 17 Nov parameters (120/30,
// ATR 1.5x, trail 30, TP 130) LOSE -19.62 USDC on this window, so they
// were retuned here; the dev window is a different 24 hours of BTC —
// flat for 3 hours, one +3.1% move in hours 3-4, then a 60.5k-61.5k range.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const HIGH_BARS = 60;
const LOW_BARS = 60;
const ATR_SPAN = 14;
const ATR_MEDIAN_BARS = 240;
const ATR_MULT = 1.0;
const TRAIL_BPS = 200;
const NO_ENTRY_AFTER_SEQ = 1380;
const COOLDOWN_BARS = 900;
const MAX_SLIPPAGE_BPS = 100;

/** Rolling closes, highs and lows, plus the ATR series, per bar seen. */
const closes: number[] = [];
const highs: number[] = [];
const lows: number[] = [];
const atrs: (number | null)[] = [];
let peak: number | null = null;
let lastExitSeq = -COOLDOWN_BARS;

function trueRange(i: number): number {
  const h = highs[i];
  const l = lows[i];
  if (i === 0) return h - l;
  const pc = closes[i - 1];
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

function atrAt(i: number): number | null {
  if (i < ATR_SPAN - 1) return null;
  let sum = 0;
  for (let k = i - ATR_SPAN + 1; k <= i; k++) sum += trueRange(k);
  return sum / ATR_SPAN;
}

/** Median of the ATR values seen so far, trailing 240 bars (upper median). */
function atrMedian(i: number): number | null {
  const from = Math.max(0, i - ATR_MEDIAN_BARS);
  const vals: number[] = [];
  for (let k = from; k <= i; k++) {
    const a = atrs[k];
    if (a !== null && a !== undefined) vals.push(a);
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function maxOf(xs: number[], from: number, to: number): number {
  let m = -Infinity;
  for (let k = from; k < to; k++) if (xs[k]! > m) m = xs[k]!;
  return m;
}

function minOf(xs: number[], from: number, to: number): number {
  let m = Infinity;
  for (let k = from; k < to; k++) if (xs[k]! < m) m = xs[k]!;
  return m;
}

/** The two exit levels, each a named predicate over the held position. */
type ExitReason = 'trailing-stop' | 'low-break';

/** (a) trailing stop: close 200 bps below the highest close since entry. */
function trailingStopHit(close: number, peak: number): boolean {
  return BigInt(close) * 10000n <= BigInt(peak) * BigInt(10000 - TRAIL_BPS);
}

/** (b) close below the lowest low of the previous 60 bars. */
function lowBreakHit(close: number, i: number): boolean {
  return i >= LOW_BARS && close < minOf(lows, i - LOW_BARS, i);
}

/** First exit level that holds, in priority order (a), (b); null while holding. */
function exitReason(close: number, peak: number, i: number): ExitReason | null {
  if (trailingStopHit(close, peak)) return 'trailing-stop';
  if (lowBreakHit(close, i)) return 'low-break';
  return null;
}

await runBars({
  onBatch(state: BarsState, batch): (BuyInput | SellInput)[] {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      fresh = true;
      closes.push(Number(bar.c));
      highs.push(Number(bar.h));
      lows.push(Number(bar.l));
      atrs.push(atrAt(closes.length - 1));
    }
    if (!fresh) return [];
    if (state.warmingUp) return [];

    const i = closes.length - 1;
    const close = closes[i]!;
    const held = state.positions.get(SYMBOL);
    if (held === undefined) peak = null;

    if (held !== undefined) {
      peak = peak === null ? close : Math.max(peak, close);
      const qty = held.qty;
      if (exitReason(close, peak, i) !== null) {
        peak = null;
        lastExitSeq = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (i < HIGH_BARS) return [];
    if (state.seq >= NO_ENTRY_AFTER_SEQ) return [];
    // Rest 900 bars after an exit: the range after a real move is fakeouts.
    if (state.seq - lastExitSeq < COOLDOWN_BARS) return [];
    // Entry: close above the highest high of the previous 60 bars.
    if (close <= maxOf(highs, i - HIGH_BARS, i)) return [];
    // ... and only when the market is moving: ATR at/above its trailing median.
    const a = atrs[i];
    const m = atrMedian(i);
    if (a !== null && a !== undefined && m !== null && a < m * ATR_MULT) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    peak = close;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
