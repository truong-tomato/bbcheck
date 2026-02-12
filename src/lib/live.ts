import { appConfig } from "@/lib/config";
import { getConnection } from "@/lib/rpc";
import { buildSnapshot, normalizeSnapshotOptions } from "@/lib/snapshot";
import type { BuildSnapshotOptions, LiveOptions, TokenSnapshot } from "@/lib/types";
import { PublicKey } from "@solana/web3.js";

interface RequiredLiveOptions extends Required<BuildSnapshotOptions> {
  pollIntervalMs: number;
  forceRefreshMs: number;
}

interface LiveSubscriber {
  onSnapshot: (snapshot: TokenSnapshot) => void;
  onError?: (error: Error) => void;
}

interface LiveState {
  key: string;
  mint: string;
  options: RequiredLiveOptions;
  subscribers: Set<LiveSubscriber>;
  snapshot: TokenSnapshot | null;
  activityFingerprint: string;
  lastRefreshAt: number;
  isRefreshing: boolean;
  timer: NodeJS.Timeout | null;
}

const states = new Map<string, LiveState>();

const buildStateKey = (mint: string, options: RequiredLiveOptions): string => {
  return [
    mint,
    options.holderLimit,
    options.edgeWalletLimit,
    options.txLimit,
    options.maxSignatures,
    options.pollIntervalMs,
    options.forceRefreshMs
  ].join(":");
};

const normalizeLiveOptions = (options: LiveOptions = {}): RequiredLiveOptions => {
  const base = normalizeSnapshotOptions(options);

  return {
    ...base,
    pollIntervalMs: options.pollIntervalMs ?? appConfig.livePollIntervalMs,
    forceRefreshMs: options.forceRefreshMs ?? appConfig.liveForceRefreshMs
  };
};

const notifySnapshot = (state: LiveState, snapshot: TokenSnapshot): void => {
  for (const subscriber of state.subscribers) {
    subscriber.onSnapshot(snapshot);
  }
};

const notifyError = (state: LiveState, error: Error): void => {
  for (const subscriber of state.subscribers) {
    subscriber.onError?.(error);
  }
};

const fetchActivityFingerprint = async (wallets: string[]): Promise<string> => {
  if (wallets.length === 0) {
    return "";
  }

  const connection = getConnection();

  const signatures = await Promise.all(
    wallets.map(async (wallet) => {
      try {
        const latest = await connection.getSignaturesForAddress(
          new PublicKey(wallet),
          { limit: 1 },
          "confirmed"
        );

        return latest[0]?.signature ?? "none";
      } catch {
        return "error";
      }
    })
  );

  return signatures.join("|");
};

const refreshState = async (state: LiveState): Promise<void> => {
  if (state.isRefreshing) {
    return;
  }

  state.isRefreshing = true;

  try {
    const snapshot = await buildSnapshot(state.mint, state.options);
    const trackedWallets = snapshot.nodes.slice(0, state.options.edgeWalletLimit).map((node) => node.address);

    state.snapshot = snapshot;
    state.lastRefreshAt = Date.now();
    state.activityFingerprint = await fetchActivityFingerprint(trackedWallets);

    notifySnapshot(state, snapshot);
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error("Unknown live refresh failure");
    notifyError(state, normalizedError);
  } finally {
    state.isRefreshing = false;
  }
};

const tickState = async (state: LiveState): Promise<void> => {
  if (!state.snapshot) {
    await refreshState(state);
    return;
  }

  const now = Date.now();
  const stale = now - state.lastRefreshAt >= state.options.forceRefreshMs;
  if (stale) {
    await refreshState(state);
    return;
  }

  const trackedWallets = state.snapshot.nodes.slice(0, state.options.edgeWalletLimit).map((node) => node.address);
  const fingerprint = await fetchActivityFingerprint(trackedWallets);

  if (fingerprint !== state.activityFingerprint) {
    await refreshState(state);
  }
};

const startState = (state: LiveState): void => {
  void refreshState(state);

  state.timer = setInterval(() => {
    void tickState(state);
  }, state.options.pollIntervalMs);
};

const ensureState = (mint: string, options: RequiredLiveOptions): LiveState => {
  const key = buildStateKey(mint, options);
  const existing = states.get(key);
  if (existing) {
    return existing;
  }

  const state: LiveState = {
    key,
    mint,
    options,
    subscribers: new Set(),
    snapshot: null,
    activityFingerprint: "",
    lastRefreshAt: 0,
    isRefreshing: false,
    timer: null
  };

  states.set(key, state);
  startState(state);

  return state;
};

const stopState = (state: LiveState): void => {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  states.delete(state.key);
};

export const subscribeToLiveSnapshots = async (
  mint: string,
  options: LiveOptions,
  onSnapshot: (snapshot: TokenSnapshot) => void,
  onError?: (error: Error) => void
): Promise<() => void> => {
  const normalizedOptions = normalizeLiveOptions(options);
  const state = ensureState(mint, normalizedOptions);

  const subscriber: LiveSubscriber = {
    onSnapshot,
    onError
  };

  state.subscribers.add(subscriber);

  if (state.snapshot) {
    onSnapshot(state.snapshot);
  }

  return () => {
    state.subscribers.delete(subscriber);

    if (state.subscribers.size === 0) {
      stopState(state);
    }
  };
};
