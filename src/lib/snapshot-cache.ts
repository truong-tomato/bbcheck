import { appConfig } from "@/lib/config";
import type { BuildSnapshotOptions, TokenSnapshot } from "@/lib/types";

interface CacheEntry {
  expiresAt: number;
  snapshot: TokenSnapshot;
}

const cache = new Map<string, CacheEntry>();

export const buildSnapshotCacheKey = (mint: string, options: Required<BuildSnapshotOptions>): string => {
  return [
    mint,
    options.holderLimit,
    options.edgeWalletLimit,
    options.txLimit,
    options.maxSignatures
  ].join(":");
};

export const getCachedSnapshot = (key: string): TokenSnapshot | null => {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.snapshot;
};

export const setCachedSnapshot = (key: string, snapshot: TokenSnapshot): void => {
  cache.set(key, {
    snapshot,
    expiresAt: Date.now() + appConfig.snapshotTtlMs
  });
};
