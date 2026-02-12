# BBubblemap

Token holder bubblemap + high-volume trading board for Gorbagana.

## Access control

- App access can be gated by wallet balance.
- User must connect wallet and hold at least `1,000,000 $BB`.
- Required token mint: `APxsyvmenL6WxTS8f4JUZ2wtimgyTwywNC1bdNoRwi5d`.
- Toggle with `ENABLE_BB_ACCESS_GATE` (`true` by default, set `false` to disable).

## What it does

- Builds snapshot graph for a mint:
  - holder bubbles (`nodes`)
  - transfer connections (`edges`)
- High Volume Board page (`/high-volume-board`) for Bang + Trashbin:
  - scans recent signatures for configured Bang/Trashbin program IDs
  - derives buy/sell pressure from token deltas vs owner quote-asset (wrapped SOL or native balance) delta
  - ranks wallets by total GOR volume and net flow
  - filters results by minimum total GOR threshold (default: `25,000`)

## API

### `GET /api/snapshot?mint=<MINT>&n=120&edgeWallets=30&txLimit=120`

Returns one cached/on-demand snapshot.

### `GET /api/high-volume?limit=40&perProgramLimit=120&minTotalGor=25000&refresh=1`

Returns high-volume board snapshot from recent Bang/Trashbin activity.

## High Volume config

Override source programs with environment variables:

```bash
HIGH_VOLUME_BANG_PROGRAM_IDS=BANGM1VB3At4Edot22MV5NGCEENcEsdxsURM9X4iQpQf,BANGS1E3rw36jue2sL1xLDp4cMxHm2Cc5bQRSAkz9BGr,BANG11ZNGMexiuLDqqifVoW7mfX2BKLYLwzNPhJrAwnN,6T6Ud5gQWwbcG6b7SixvukR3scT1GTqot37y3ztAG7eH,6YWQdKjPb1m6VZMFCrtuSpYKqubcj7RRt22ePR3GQq2h
HIGH_VOLUME_TRASHBIN_PROGRAM_IDS=BAEZRQHD9aZky1yNeXjv7yHAXXeZ2B8QHtXmy8gn5ETZ,DYgGxvJD8GTYQSGFmT4RUab5TJ7W3m7Vrbg2UueNzAq8
HIGH_VOLUME_MIN_TOTAL_GOR=25000
```

Client RPC for wallet-gate balance checks (optional override):

```bash
NEXT_PUBLIC_GORBAGANA_RPC_URL=https://rpc.gorbagana.wtf/
```

## Local run

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
cp .env.example .env.local
```

3. Start app

```bash
npm run dev
```

## Notes

- High-volume classification is heuristic (owner-level token delta vs quote-asset delta).
- For production-grade analytics, add source-specific event decoding/indexing per program.
