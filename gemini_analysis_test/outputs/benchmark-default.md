# Gemini video-analysis benchmark (default media resolution)

Costs are paid list prices applied to measured token counts. "Read" is the cost of the model taking in the video and prompt; "write" is its answer plus its thinking tokens.

## Getting a 2 GB game to Gemini (before any analysis starts)

Measured from this machine: the 173 MB fixture took 41s to upload (237s per GB) and 19s for Google to process. At that rate a 2 GB game uploads in about **7.9 minutes**. Processing time for a 90-minute file is not measured here; upload speed depends on the sender's connection, and a server in a data centre would be faster than this one. The upload itself is free (Files API storage is not billed; files expire after 48 hours).

## Prompt 1: three highlight plays (free text)

### Each call, as measured

| Video | Model | Quality (you grade) | Analysis time | Time per video-second | Input tokens | Output tokens | Thinking tokens | Read cost | Write cost | Read share | Total | Cost per video-second |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| staging-verification-fixture-5min (301s) | gemini-4-hydrogen |  | 47s | 0.16s | 31,673 | 956 | 3,223 | $0.0475 | $0.0313 | 60% | $0.0789 | $0.000262 |
| staging-verification-fixture-5min (301s) | gemini-3.6-flash |  | 30s | 0.10s | 27,428 | 603 | 1,199 | $0.0206 | $0.0068 | 75% | $0.0273 | $0.000091 |
| staging-verification-fixture-5min (301s) | gemini-3.5-flash-lite |  | 33s | 0.11s | 27,428 | 204 | 0 | $0.0082 | $0.0005 | 94% | $0.0087 | $0.000029 |
| staging-verification-fixture-5min (301s) | gemini-3-flash-preview |  | 14s | 0.04s | 27,428 | 413 | 1,557 | $0.0137 | $0.0059 | 70% | $0.0196 | $0.000065 |
| staging-verification-fixture-5min (301s) | gemini-3.1-flash-lite |  | 23s | 0.08s | 27,428 | 340 | 0 | $0.0069 | $0.0005 | 93% | $0.0074 | $0.000024 |
| wcfc-carlsbad-trimmed (89s) | gemini-4-hydrogen |  | 26s | 0.29s | 6,568 | 1,088 | 2,410 | $0.0099 | $0.0262 | 27% | $0.0361 | $0.000404 |
| wcfc-carlsbad-trimmed (89s) | gemini-3.6-flash |  | 184s | 2.06s | 5,915 | 591 | 1,022 | $0.0044 | $0.0060 | 42% | $0.0105 | $0.000117 |
| wcfc-carlsbad-trimmed (89s) | gemini-3.5-flash-lite |  | 5s | 0.06s | 5,915 | 377 | 0 | $0.0018 | $0.0009 | 65% | $0.0027 | $0.000030 |
| wcfc-carlsbad-trimmed (89s) | gemini-3.1-flash-lite |  | 4s | 0.04s | 5,915 | 457 | 0 | $0.0015 | $0.0007 | 68% | $0.0022 | $0.000024 |

### Extrapolated to one 90-minute, 2 GB game

The game is sent as one call (about half a million input tokens, inside the 1M limit). File size does not change the price: Gemini bills by video length, not bytes. "est." marks a model this key could not call today: its token counts are borrowed from the nearest model in the same family that did run (input tokens were identical across every model of a family), and it has no time measurement.

| Model | Basis | Input tokens | Output + thinking tokens | Read cost | Write cost | Cost per game today | After announced price change | Batch (half price, today) | Analysis time, calls one after another | 
|---|---|---|---|---|---|---|---|---|---|
| gemini-4-hydrogen | measured | 568,519 | 4,179 | $0.85 | $0.03 | **$0.88** | no change announced | $0.44 | about 14 min (straight-line guess) | 
| gemini-3.6-flash | measured | 492,322 | 1,802 | $0.37 | $0.01 | **$0.38** | $0.75 (from 2027-01-01) | $0.19 | about 9 min (straight-line guess) | 
| gemini-3.5-flash-lite | measured | 492,322 | 204 | $0.15 | $0.00 | **$0.15** | no change announced | $0.07 | about 10 min (straight-line guess) | 
| gemini-3-flash-preview | measured | 492,322 | 1,970 | $0.25 | $0.01 | **$0.25** | no change announced | $0.13 | about 4 min (straight-line guess) | 
| gemini-3.1-flash-lite | measured | 492,322 | 340 | $0.12 | $0.00 | **$0.12** | no change announced | $0.06 | about 7 min (straight-line guess) | 

### Calls that failed

| Video | Model | Why |
|---|---|---|
| staging-verification-fixture-5min | gemini-3.8-flash | free-tier daily request limit reached |
| staging-verification-fixture-5min | gemini-4-argon | free tier does not include this model (quota 0); needs billing enabled |
| staging-verification-fixture-5min | gemini-4-carbon | free tier does not include this model (quota 0); needs billing enabled |
| staging-verification-fixture-5min | gemini-3.1-pro-preview | free tier does not include this model (quota 0); needs billing enabled |
| wcfc-carlsbad-trimmed | gemini-3-flash-preview | free-tier daily request limit reached |
| wcfc-carlsbad-trimmed | gemini-3.8-flash | free-tier daily request limit reached |
| wcfc-carlsbad-trimmed | gemini-4-argon | free tier does not include this model (quota 0); needs billing enabled |
| wcfc-carlsbad-trimmed | gemini-4-carbon | free tier does not include this model (quota 0); needs billing enabled |
| wcfc-carlsbad-trimmed | gemini-3.1-pro-preview | free tier does not include this model (quota 0); needs billing enabled |

## Prompt 2: complete play-by-play (JSON, per-player scores)

### Each call, as measured

| Video | Model | Quality (you grade) | Analysis time | Time per video-second | Input tokens | Output tokens | Thinking tokens | Read cost | Write cost | Read share | Total | Cost per video-second |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| staging-verification-fixture-5min (301s) | gemini-4-hydrogen [22 plays] |  | 67s | 0.22s | 33,707 | 3,769 | 5,565 | $0.0506 | $0.0700 | 42% | $0.1206 | $0.000401 |
| staging-verification-fixture-5min (301s) | gemini-3.5-flash-lite [6 plays] |  | 31s | 0.10s | 27,900 | 1,598 | 0 | $0.0084 | $0.0040 | 68% | $0.0124 | $0.000041 |
| staging-verification-fixture-5min (301s) | gemini-3.1-flash-lite [5 plays] |  | 25s | 0.08s | 27,900 | 1,213 | 0 | $0.0070 | $0.0018 | 79% | $0.0088 | $0.000029 |
| wcfc-carlsbad-trimmed (89s) | gemini-4-hydrogen [11 plays] |  | 105s | 1.18s | 8,602 | 1,895 | 18,913 | $0.0129 | $0.1561 | 8% | $0.1690 | $0.001892 |
| wcfc-carlsbad-trimmed (89s) | gemini-3.5-flash-lite [3 plays] |  | 8s | 0.09s | 6,387 | 843 | 0 | $0.0019 | $0.0021 | 48% | $0.0040 | $0.000045 |
| wcfc-carlsbad-trimmed (89s) | gemini-3.1-flash-lite [6 plays] |  | 8s | 0.09s | 6,387 | 1,470 | 0 | $0.0016 | $0.0022 | 42% | $0.0038 | $0.000043 |

### Extrapolated to one 90-minute, 2 GB game

The game is cut into 18 five-minute calls (a play-by-play of 90 minutes is too long for one answer). File size does not change the price: Gemini bills by video length, not bytes. "est." marks a model this key could not call today: its token counts are borrowed from the nearest model in the same family that did run (input tokens were identical across every model of a family), and it has no time measurement.

| Model | Basis | Input tokens | Output + thinking tokens | Read cost | Write cost | Cost per game today | After announced price change | Batch (half price, today) | Analysis time, calls one after another | Analysis time, all pieces in parallel |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-4-hydrogen | measured | 605,028 | 167,542 | $0.91 | $1.26 | **$2.16** | no change announced | $1.08 | 20 min | about 67s | 
| gemini-3.5-flash-lite | measured | 500,795 | 28,684 | $0.15 | $0.07 | **$0.22** | no change announced | $0.11 | 9 min | about 31s | 
| gemini-3.1-flash-lite | measured | 500,795 | 21,773 | $0.13 | $0.03 | **$0.16** | no change announced | $0.08 | 8 min | about 25s | 

### Calls that failed

| Video | Model | Why |
|---|---|---|
| staging-verification-fixture-5min | gemini-3.6-flash | free-tier daily request limit reached |
| wcfc-carlsbad-trimmed | gemini-3.6-flash | free-tier daily request limit reached |

