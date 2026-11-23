# btc-race-24h-20261123-0511

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/JohnyKucel/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/JohnyKucel/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

BounceRider — a Donchian breakout bot that trades Coinbase Wrapped BTC (cbBTC) minute by minute on 1-minute on-chain bars, for the make.fun "Race a BTC trading bot live for 24 hours" bounty ($50 in USDC). Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty, $50 in USDC.

## Strategy

Long only, one asset, full-size entries, few trades. It enters when the 1-minute close breaks above the highest high of the previous 60 bars, and only when the market is actually moving (14-bar ATR at or above its trailing 240-bar median). After an exit it rests 900 bars (15 hours) before it may enter again. It exits the whole position on the first of: a trailing stop 200 bps below the highest close since entry, or the close falling to the lowest low of the previous 60 bars. There is no take-profit. No new entries in the final 60 bars of the window. All money math is integer (BigInt); indicators are float64, so the same bars give the same orders, run after run.

## Dev-window result (kit grade-local, process driver)

Net PnL **+21.262128 USDC** on $1,000 starting capital, 2 trades (1 round trip, entry bar 184, exit bar 433 on the 60-bar low break, held 249 bars), win rate 1.000, max drawdown 1.4274%, fees $0.808669, 0 rejected orders, guardrails met, L1 regrade reproduced (deterministic), result sha `eae79bda27d4dbb2e4caa09cbb668d4c0c4fabd42d3a5e675e76b36750be02da`. At 2x fees net PnL still +20.446374 USDC. The house EMA-cross baseline loses −114.83 USDC on the same window; buy-and-hold +32.17 USDC. The parameters sit on a wide plateau, not a knife edge: hi 20–150, lo 50–80, trail 120–10000 bps, ATR 0.9–1.5x, cooldown 900+ bars all give the identical +21.26. What breaks it: trail 80–100 bps (+0.63 to +3.14), lo 20 (+0.63), ATR 2.0x (+16.20). The edge is selectivity plus patience: the dev window is flat for 3 hours, makes one +3.1% move in hours 3–4, then ranges 60.5k–61.5k for 19 hours — the bot rides the one real move with a wide trail and then rests while the range fakes out every breakout. The 17 Nov parameters (120/30, ATR 1.5x, trail 30, TP 130) lose −19.62 USDC on this window, so they were retuned here — the dev window is a different 24 hours of BTC.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 (newline-delimited JSON on stdin/stdout). `vendor/makefun-bars.ts` is a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=jy3a6hm3&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
