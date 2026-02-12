import { PublicKey, type ParsedTransactionWithMeta, type TokenBalance } from "@solana/web3.js";
import { getConnection } from "@/lib/rpc";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_GOR = 1_000_000_000;
const DEFAULT_LIMIT_PER_PROGRAM = 80;
const DEFAULT_RESULT_LIMIT = 30;
const DEFAULT_MIN_TOTAL_GOR = 25_000;
const CACHE_TTL_MS = 6_000;

export interface HighVolumeBoardEntry {
  source: "bang.meme" | "trashbin.fun";
  wallet: string;
  buyVolume: number;
  sellVolume: number;
  netVolume: number;
  totalVolume: number;
  buyTxCount: number;
  sellTxCount: number;
  tokenCount: number;
  lastActivity: number | null;
}

export interface HighVolumeBoardSnapshot {
  timestamp: number;
  entries: HighVolumeBoardEntry[];
  scannedSignatures: number;
  scannedTransactions: number;
  minTotalGor: number;
}

interface ProgramSource {
  source: "bang.meme" | "trashbin.fun";
  address: PublicKey;
}

interface AggregateEntry {
  source: "bang.meme" | "trashbin.fun";
  wallet: string;
  buyVolume: number;
  sellVolume: number;
  lastActivity: number | null;
  mints: Set<string>;
  buySignatures: Set<string>;
  sellSignatures: Set<string>;
}

interface CachedBoard {
  expiresAt: number;
  snapshot: HighVolumeBoardSnapshot;
}

interface OwnerMintDelta {
  owner: string;
  mint: string;
  deltaRaw: bigint;
  decimals: number;
}

const boardCache = new Map<string, CachedBoard>();

const parseProgramList = (value: string | undefined, defaults: string[]): string[] => {
  if (!value) {
    return defaults;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const parsePositiveNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeMinTotalGor = (value: number | undefined): number => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  return parsePositiveNumber(process.env.HIGH_VOLUME_MIN_TOTAL_GOR, DEFAULT_MIN_TOTAL_GOR);
};

const getProgramSources = (): ProgramSource[] => {
  const bangPrograms = parseProgramList(process.env.HIGH_VOLUME_BANG_PROGRAM_IDS, [
    "BANGM1VB3At4Edot22MV5NGCEENcEsdxsURM9X4iQpQf",
    "BANGS1E3rw36jue2sL1xLDp4cMxHm2Cc5bQRSAkz9BGr",
    "BANG11ZNGMexiuLDqqifVoW7mfX2BKLYLwzNPhJrAwnN",
    "6T6Ud5gQWwbcG6b7SixvukR3scT1GTqot37y3ztAG7eH",
    "6YWQdKjPb1m6VZMFCrtuSpYKqubcj7RRt22ePR3GQq2h"
  ]);
  const trashbinPrograms = parseProgramList(process.env.HIGH_VOLUME_TRASHBIN_PROGRAM_IDS, [
    "BAEZRQHD9aZky1yNeXjv7yHAXXeZ2B8QHtXmy8gn5ETZ",
    "DYgGxvJD8GTYQSGFmT4RUab5TJ7W3m7Vrbg2UueNzAq8"
  ]);

  const sources: ProgramSource[] = [];

  for (const programId of bangPrograms) {
    try {
      sources.push({
        source: "bang.meme",
        address: new PublicKey(programId)
      });
    } catch {
      // Ignore invalid env values and continue with other programs.
    }
  }

  for (const programId of trashbinPrograms) {
    try {
      sources.push({
        source: "trashbin.fun",
        address: new PublicKey(programId)
      });
    } catch {
      // Ignore invalid env values and continue with other programs.
    }
  }

  return sources;
};

const keyForOwnerMint = (owner: string, mint: string): string => `${owner}:${mint}`;

const parseRawAmount = (balance: TokenBalance): bigint => {
  const raw = balance.uiTokenAmount?.amount;
  if (!raw) {
    return 0n;
  }

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
};

const normalizeTokenAccountKey = (tx: ParsedTransactionWithMeta, accountIndex: number): string | null => {
  const key = tx.transaction.message.accountKeys[accountIndex];

  if (!key) {
    return null;
  }

  if (typeof key === "string") {
    return key;
  }

  if (typeof key === "object" && "pubkey" in key) {
    const pubkey = key.pubkey;
    if (typeof pubkey === "string") {
      return pubkey;
    }

    if (pubkey instanceof PublicKey) {
      return pubkey.toBase58();
    }
  }

  if (key instanceof PublicKey) {
    return key.toBase58();
  }

  return null;
};

const extractOwnerMintDeltas = (tx: ParsedTransactionWithMeta): OwnerMintDelta[] => {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const tokenAccountToOwnerMint = new Map<string, { owner: string; mint: string; decimals: number }>();

  for (const balance of [...pre, ...post]) {
    const accountKey = normalizeTokenAccountKey(tx, balance.accountIndex);
    if (!accountKey || !balance.owner || !balance.mint) {
      continue;
    }

    tokenAccountToOwnerMint.set(accountKey, {
      owner: balance.owner,
      mint: balance.mint,
      decimals: balance.uiTokenAmount?.decimals ?? 0
    });
  }

  const states = new Map<string, { owner: string; mint: string; decimals: number; pre: bigint; post: bigint }>();

  for (const balance of pre) {
    const accountKey = normalizeTokenAccountKey(tx, balance.accountIndex);
    if (!accountKey) {
      continue;
    }

    const meta = tokenAccountToOwnerMint.get(accountKey);
    if (!meta) {
      continue;
    }

    const key = keyForOwnerMint(meta.owner, meta.mint);
    const current = states.get(key) ?? {
      owner: meta.owner,
      mint: meta.mint,
      decimals: meta.decimals,
      pre: 0n,
      post: 0n
    };

    current.pre += parseRawAmount(balance);
    states.set(key, current);
  }

  for (const balance of post) {
    const accountKey = normalizeTokenAccountKey(tx, balance.accountIndex);
    if (!accountKey) {
      continue;
    }

    const meta = tokenAccountToOwnerMint.get(accountKey);
    if (!meta) {
      continue;
    }

    const key = keyForOwnerMint(meta.owner, meta.mint);
    const current = states.get(key) ?? {
      owner: meta.owner,
      mint: meta.mint,
      decimals: meta.decimals,
      pre: 0n,
      post: 0n
    };

    current.post += parseRawAmount(balance);
    states.set(key, current);
  }

  const deltas: OwnerMintDelta[] = [];

  for (const value of states.values()) {
    const deltaRaw = value.post - value.pre;
    if (deltaRaw === 0n) {
      continue;
    }

    deltas.push({
      owner: value.owner,
      mint: value.mint,
      decimals: value.decimals,
      deltaRaw
    });
  }

  return deltas;
};

const extractOwnerLamportDeltas = (tx: ParsedTransactionWithMeta): Map<string, bigint> => {
  const result = new Map<string, bigint>();
  const preBalances = tx.meta?.preBalances ?? [];
  const postBalances = tx.meta?.postBalances ?? [];
  const count = Math.min(preBalances.length, postBalances.length);

  for (let index = 0; index < count; index += 1) {
    const owner = normalizeTokenAccountKey(tx, index);
    if (!owner) {
      continue;
    }

    const pre = BigInt(Math.trunc(preBalances[index] ?? 0));
    const post = BigInt(Math.trunc(postBalances[index] ?? 0));
    const delta = post - pre;

    if (delta !== 0n) {
      result.set(owner, delta);
    }
  }

  return result;
};

const rawToUi = (value: bigint, decimals: number): number => {
  if (value === 0n) {
    return 0;
  }

  const divisor = 10n ** BigInt(Math.max(0, decimals));
  const abs = value < 0n ? -value : value;
  const whole = abs / divisor;
  const fraction = abs % divisor;

  const amount = Number(whole) + Number(fraction) / Number(divisor);
  return value < 0n ? -amount : amount;
};

const collectTradeSignals = (
  tx: ParsedTransactionWithMeta,
  signature: string,
  sources: Set<"bang.meme" | "trashbin.fun">,
  aggregate: Map<string, AggregateEntry>
): void => {
  const deltas = extractOwnerMintDeltas(tx);
  if (deltas.length === 0 || sources.size === 0) {
    return;
  }

  const byOwner = new Map<string, OwnerMintDelta[]>();
  const ownerLamportDeltas = extractOwnerLamportDeltas(tx);

  for (const delta of deltas) {
    const list = byOwner.get(delta.owner) ?? [];
    list.push(delta);
    byOwner.set(delta.owner, list);
  }

  const blockTimeMs = tx.blockTime ? tx.blockTime * 1000 : null;

  for (const [owner, ownerDeltas] of byOwner.entries()) {
    const wrappedSolDelta = ownerDeltas.find((delta) => delta.mint === WRAPPED_SOL_MINT);
    const quoteDeltaUi =
      wrappedSolDelta !== undefined
        ? rawToUi(wrappedSolDelta.deltaRaw, wrappedSolDelta.decimals)
        : Number(ownerLamportDeltas.get(owner) ?? 0n) / LAMPORTS_PER_GOR;

    if (quoteDeltaUi === 0) {
      continue;
    }

    const candidates: Array<{ mint: string; isBuy: boolean; isSell: boolean; tokenAbs: number }> = [];

    for (const delta of ownerDeltas) {
      if (delta.mint === WRAPPED_SOL_MINT) {
        continue;
      }

      const tokenDeltaUi = rawToUi(delta.deltaRaw, delta.decimals);
      if (tokenDeltaUi === 0) {
        continue;
      }

      const isBuy = tokenDeltaUi > 0 && quoteDeltaUi < 0;
      const isSell = tokenDeltaUi < 0 && quoteDeltaUi > 0;

      if (!isBuy && !isSell) {
        continue;
      }

      candidates.push({
        mint: delta.mint,
        isBuy,
        isSell,
        tokenAbs: Math.abs(tokenDeltaUi)
      });
    }

    if (candidates.length === 0) {
      continue;
    }

    const totalTokenAbs = candidates.reduce((sum, candidate) => sum + candidate.tokenAbs, 0);
    const quoteAbs = Math.abs(quoteDeltaUi);

    for (const source of sources) {
      const key = `${source}:${owner}`;
      const current = aggregate.get(key) ?? {
        source,
        wallet: owner,
        buyVolume: 0,
        sellVolume: 0,
        lastActivity: null,
        mints: new Set<string>(),
        buySignatures: new Set<string>(),
        sellSignatures: new Set<string>()
      };

      for (const candidate of candidates) {
        const volumeShare =
          totalTokenAbs > 0 ? quoteAbs * (candidate.tokenAbs / totalTokenAbs) : quoteAbs / candidates.length;

        current.mints.add(candidate.mint);

        if (candidate.isBuy) {
          current.buyVolume += volumeShare;
          current.buySignatures.add(signature);
        }

        if (candidate.isSell) {
          current.sellVolume += volumeShare;
          current.sellSignatures.add(signature);
        }
      }

      current.lastActivity = Math.max(current.lastActivity ?? 0, blockTimeMs ?? 0) || null;
      aggregate.set(key, current);
    }
  }
};

const toBoardEntry = (entry: AggregateEntry): HighVolumeBoardEntry => {
  const netVolume = entry.buyVolume - entry.sellVolume;
  const totalVolume = entry.buyVolume + entry.sellVolume;

  return {
    source: entry.source,
    wallet: entry.wallet,
    buyVolume: entry.buyVolume,
    sellVolume: entry.sellVolume,
    netVolume,
    totalVolume,
    buyTxCount: entry.buySignatures.size,
    sellTxCount: entry.sellSignatures.size,
    tokenCount: entry.mints.size,
    lastActivity: entry.lastActivity
  };
};

export const buildHighVolumeBoard = async (
  limit = DEFAULT_RESULT_LIMIT,
  perProgramLimit = DEFAULT_LIMIT_PER_PROGRAM,
  forceRefresh = false,
  minTotalGor?: number
): Promise<HighVolumeBoardSnapshot> => {
  const safeLimit = Math.max(1, Math.trunc(limit));
  const safePerProgramLimit = Math.max(10, Math.trunc(perProgramLimit));
  const safeMinTotalGor = normalizeMinTotalGor(minTotalGor);
  const cacheKey = `${safeLimit}:${safePerProgramLimit}:${safeMinTotalGor.toFixed(4)}`;

  if (!forceRefresh) {
    const cachedBoard = boardCache.get(cacheKey);
    if (cachedBoard && cachedBoard.expiresAt > Date.now()) {
      return cachedBoard.snapshot;
    }
  }

  const programs = getProgramSources();
  if (programs.length === 0) {
    return {
      timestamp: Date.now(),
      entries: [],
      scannedSignatures: 0,
      scannedTransactions: 0,
      minTotalGor: safeMinTotalGor
    };
  }

  const connection = getConnection();
  const signatureSources = new Map<string, Set<"bang.meme" | "trashbin.fun">>();

  await Promise.all(
    programs.map(async (program) => {
      try {
        const signatures = await connection.getSignaturesForAddress(program.address, {
          limit: safePerProgramLimit
        });

        for (const signatureInfo of signatures) {
          const set = signatureSources.get(signatureInfo.signature) ?? new Set<"bang.meme" | "trashbin.fun">();
          set.add(program.source);
          signatureSources.set(signatureInfo.signature, set);
        }
      } catch {
        // Ignore unavailable programs and continue with remaining sources.
      }
    })
  );

  const signatures = [...signatureSources.keys()];
  const parsedTransactions: ParsedTransactionWithMeta[] = [];

  for (let i = 0; i < signatures.length; i += 25) {
    const chunk = signatures.slice(i, i + 25);

    try {
      const transactions = await connection.getParsedTransactions(chunk, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed"
      });

      for (const tx of transactions) {
        if (tx) {
          parsedTransactions.push(tx);
        }
      }
    } catch {
      // Continue processing other chunks when RPC rejects one batch.
    }
  }

  const aggregate = new Map<string, AggregateEntry>();

  for (const tx of parsedTransactions) {
    const signature = tx.transaction.signatures[0];
    if (!signature) {
      continue;
    }

    const sources = signatureSources.get(signature);
    if (!sources) {
      continue;
    }

    collectTradeSignals(tx, signature, sources, aggregate);
  }

  const rankedEntries = [...aggregate.values()]
    .map(toBoardEntry)
    .filter((entry) => entry.totalVolume >= safeMinTotalGor)
    .sort((a, b) => {
      if (a.totalVolume === b.totalVolume) {
        return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
      }

      return b.totalVolume - a.totalVolume;
    })
    .slice(0, safeLimit);

  const snapshot: HighVolumeBoardSnapshot = {
    timestamp: Date.now(),
    entries: rankedEntries,
    scannedSignatures: signatures.length,
    scannedTransactions: parsedTransactions.length,
    minTotalGor: safeMinTotalGor
  };

  boardCache.set(cacheKey, {
    snapshot,
    expiresAt: Date.now() + CACHE_TTL_MS
  });

  return snapshot;
};
