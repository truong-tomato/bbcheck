const parseIntWithDefault = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

export const appConfig = {
  rpcUrl: process.env.GORBAGANA_RPC_URL ?? "https://rpc.gorbagana.wtf/",
  holderLimit: clamp(parseIntWithDefault(process.env.SNAPSHOT_HOLDER_LIMIT, 120), 20, 300),
  edgeWalletLimit: clamp(parseIntWithDefault(process.env.SNAPSHOT_EDGE_WALLET_LIMIT, 30), 5, 80),
  txLimit: clamp(parseIntWithDefault(process.env.SNAPSHOT_TX_LIMIT, 120), 20, 400),
  maxSignatures: clamp(parseIntWithDefault(process.env.SNAPSHOT_MAX_SIGNATURES, 1500), 100, 5000),
  snapshotTtlMs: clamp(parseIntWithDefault(process.env.SNAPSHOT_TTL_MS, 30 * 60 * 1000), 5_000, 3 * 60 * 60 * 1000),
  livePollIntervalMs: clamp(parseIntWithDefault(process.env.LIVE_POLL_INTERVAL_MS, 8_000), 2_000, 60_000),
  liveForceRefreshMs: clamp(parseIntWithDefault(process.env.LIVE_FORCE_REFRESH_MS, 10 * 60 * 1000), 60_000, 60 * 60 * 1000),
  liveHeartbeatMs: clamp(parseIntWithDefault(process.env.LIVE_HEARTBEAT_MS, 20_000), 5_000, 60_000)
};

export const parseLimitParam = (
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, min, max);
};
