import {
  Connection,
  type ParsedAccountData,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  PublicKey,
  type GetProgramAccountsFilter,
  type SignaturesForAddressOptions,
  type TokenBalance
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { appConfig } from "@/lib/config";
import type { TokenProgramKind, TransferEvent } from "@/lib/types";
import { toUiAmount } from "@/lib/math";

let sharedConnection: Connection | null = null;

interface MintMetadata {
  decimals: number;
  supplyRaw: bigint;
  supply: number;
  tokenProgram: TokenProgramKind;
  tokenProgramId: PublicKey;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenUri: string | null;
}

interface TokenAccountMetadata {
  mint?: string;
  owner?: string;
}

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const runInBatches = async <T, R>(
  items: readonly T[],
  batchSize: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(chunk.map(worker));
    results.push(...batchResults);
  }

  return results;
};

const normalizeAccountKey = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && "pubkey" in value) {
    const pubkey = (value as { pubkey: string | PublicKey }).pubkey;
    return typeof pubkey === "string" ? pubkey : pubkey.toBase58();
  }

  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  return null;
};

const normalizeDisplayString = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\0/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
};

const readStringField = (value: unknown): string | null => {
  return typeof value === "string" ? normalizeDisplayString(value) : null;
};

const readNestedField = (value: unknown, key: string): string | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const nested = (value as Record<string, unknown>)[key];
  return readStringField(nested);
};

const parseBorshString = (data: Buffer, offset: number): { value: string | null; nextOffset: number } | null => {
  if (offset + 4 > data.length) {
    return null;
  }

  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;

  if (end > data.length) {
    return null;
  }

  const raw = data.subarray(start, end).toString("utf8");
  return {
    value: normalizeDisplayString(raw),
    nextOffset: end
  };
};

const extractTokenMetadataFromParsedMint = (
  parsedInfo: Record<string, unknown>
): { tokenName: string | null; tokenSymbol: string | null; tokenUri: string | null } => {
  let tokenName = readStringField(parsedInfo.name);
  let tokenSymbol = readStringField(parsedInfo.symbol);
  let tokenUri = readStringField(parsedInfo.uri);

  const extensions = Array.isArray(parsedInfo.extensions) ? parsedInfo.extensions : [];
  for (const extension of extensions) {
    if (!extension || typeof extension !== "object") {
      continue;
    }

    tokenName = tokenName ?? readNestedField(extension, "name");
    tokenSymbol = tokenSymbol ?? readNestedField(extension, "symbol");
    tokenUri = tokenUri ?? readNestedField(extension, "uri");

    const state = (extension as Record<string, unknown>).state;
    tokenName = tokenName ?? readNestedField(state, "name");
    tokenSymbol = tokenSymbol ?? readNestedField(state, "symbol");
    tokenUri = tokenUri ?? readNestedField(state, "uri");
  }

  return { tokenName, tokenSymbol, tokenUri };
};

const fetchMetaplexTokenMetadata = async (
  mint: PublicKey
): Promise<{ tokenName: string | null; tokenSymbol: string | null; tokenUri: string | null }> => {
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    METADATA_PROGRAM_ID
  );

  const connection = getConnection();
  const metadataAccount = await connection.getAccountInfo(metadataPda, "confirmed");
  if (!metadataAccount?.data) {
    return { tokenName: null, tokenSymbol: null, tokenUri: null };
  }

  const data = Buffer.from(metadataAccount.data);
  if (data.length < 65) {
    return { tokenName: null, tokenSymbol: null, tokenUri: null };
  }

  let offset = 65; // key + updateAuthority + mint

  const nameParsed = parseBorshString(data, offset);
  if (!nameParsed) {
    return { tokenName: null, tokenSymbol: null, tokenUri: null };
  }
  offset = nameParsed.nextOffset;

  const symbolParsed = parseBorshString(data, offset);
  if (!symbolParsed) {
    return { tokenName: nameParsed.value, tokenSymbol: null, tokenUri: null };
  }
  offset = symbolParsed.nextOffset;

  const uriParsed = parseBorshString(data, offset);

  return {
    tokenName: nameParsed.value,
    tokenSymbol: symbolParsed.value,
    tokenUri: uriParsed?.value ?? null
  };
};

const parseAmountRaw = (instructionInfo: Record<string, unknown>): bigint | null => {
  const raw = instructionInfo.amount ?? (instructionInfo.tokenAmount as { amount?: string } | undefined)?.amount;

  if (typeof raw === "string") {
    return BigInt(raw);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return BigInt(Math.trunc(raw));
  }

  return null;
};

const extractTokenAccountMetadata = (tx: ParsedTransactionWithMeta): Map<string, TokenAccountMetadata> => {
  const accountKeys = (tx.transaction.message.accountKeys as unknown[])
    .map(normalizeAccountKey)
    .filter((value): value is string => Boolean(value));

  const map = new Map<string, TokenAccountMetadata>();
  const balances: TokenBalance[] = [
    ...(tx.meta?.preTokenBalances ?? []),
    ...(tx.meta?.postTokenBalances ?? [])
  ];

  for (const balance of balances) {
    const account = accountKeys[balance.accountIndex];
    if (!account) {
      continue;
    }

    const existing = map.get(account) ?? {};
    map.set(account, {
      mint: balance.mint ?? existing.mint,
      owner: balance.owner ?? existing.owner
    });
  }

  return map;
};

const extractParsedInstructions = (tx: ParsedTransactionWithMeta): ParsedInstruction[] => {
  const parsedInstructions: ParsedInstruction[] = [];

  for (const instruction of tx.transaction.message.instructions as unknown[]) {
    if (instruction && typeof instruction === "object" && "parsed" in instruction) {
      parsedInstructions.push(instruction as ParsedInstruction);
    }
  }

  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const instruction of inner.instructions as unknown[]) {
      if (instruction && typeof instruction === "object" && "parsed" in instruction) {
        parsedInstructions.push(instruction as ParsedInstruction);
      }
    }
  }

  return parsedInstructions;
};

export const getConnection = (): Connection => {
  if (!sharedConnection) {
    sharedConnection = new Connection(appConfig.rpcUrl, {
      commitment: "confirmed"
    });
  }

  return sharedConnection;
};

export const toPublicKey = (value: string): PublicKey => {
  return new PublicKey(value);
};

export const fetchMintMetadata = async (mint: PublicKey): Promise<MintMetadata> => {
  const connection = getConnection();
  const accountInfo = await connection.getParsedAccountInfo(mint, "confirmed");

  if (!accountInfo.value || !("parsed" in accountInfo.value.data)) {
    throw new Error("Mint account is missing or not parsable");
  }

  const data = accountInfo.value.data as ParsedAccountData;
  if (data.parsed.type !== "mint") {
    throw new Error("Provided address is not a mint account");
  }

  const parsedInfo = data.parsed.info as Record<string, unknown>;
  const supplyRaw = BigInt(String(parsedInfo.supply ?? "0"));
  const decimals = Number(parsedInfo.decimals ?? 0);
  const ownerProgram = accountInfo.value.owner;

  let tokenProgram: TokenProgramKind;
  let tokenProgramId: PublicKey;

  if (ownerProgram.equals(TOKEN_PROGRAM_ID)) {
    tokenProgram = "spl-token";
    tokenProgramId = TOKEN_PROGRAM_ID;
  } else if (ownerProgram.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenProgram = "token-2022";
    tokenProgramId = TOKEN_2022_PROGRAM_ID;
  } else {
    throw new Error(
      `Unsupported mint owner program: ${ownerProgram.toBase58()}. Expected Token or Token-2022 program.`
    );
  }

  const parsedMetadata = extractTokenMetadataFromParsedMint(parsedInfo);
  let tokenName = parsedMetadata.tokenName;
  let tokenSymbol = parsedMetadata.tokenSymbol;
  let tokenUri = parsedMetadata.tokenUri;

  if (!tokenName || !tokenSymbol || !tokenUri) {
    try {
      const metaplexMetadata = await fetchMetaplexTokenMetadata(mint);
      tokenName = tokenName ?? metaplexMetadata.tokenName;
      tokenSymbol = tokenSymbol ?? metaplexMetadata.tokenSymbol;
      tokenUri = tokenUri ?? metaplexMetadata.tokenUri;
    } catch {
      // Not every mint has a Metaplex metadata account on Gorbagana.
    }
  }

  return {
    supplyRaw,
    decimals,
    supply: toUiAmount(supplyRaw, decimals),
    tokenProgram,
    tokenProgramId,
    tokenName,
    tokenSymbol,
    tokenUri
  };
};

export const fetchHolderBalancesByOwner = async (
  mint: PublicKey,
  tokenProgramId: PublicKey
): Promise<Map<string, bigint>> => {
  const connection = getConnection();
  const filters: GetProgramAccountsFilter[] = [
    { memcmp: { offset: 0, bytes: mint.toBase58() } }
  ];

  if (tokenProgramId.equals(TOKEN_PROGRAM_ID)) {
    // Legacy token accounts are always 165 bytes.
    filters.unshift({ dataSize: 165 });
  }

  const tokenAccounts = await connection.getParsedProgramAccounts(tokenProgramId, {
    commitment: "confirmed",
    filters
  });

  const holders = new Map<string, bigint>();

  for (const tokenAccount of tokenAccounts) {
    if (!("parsed" in tokenAccount.account.data)) {
      continue;
    }

    const parsedData = tokenAccount.account.data as ParsedAccountData;
    const accountInfo = parsedData.parsed.info as {
      owner?: string;
      tokenAmount?: { amount?: string };
    };

    const owner = accountInfo.owner;
    const amountRaw = accountInfo.tokenAmount?.amount;

    if (!owner || !amountRaw) {
      continue;
    }

    const previous = holders.get(owner) ?? 0n;
    holders.set(owner, previous + BigInt(amountRaw));
  }

  return holders;
};

const collectRecentSignatures = async (
  wallets: string[],
  txLimit: number,
  maxSignatures: number
): Promise<string[]> => {
  const connection = getConnection();
  const signatureMap = new Map<string, number>();

  await runInBatches(wallets, 8, async (wallet) => {
    const options: SignaturesForAddressOptions = { limit: txLimit };
    let signatures;

    try {
      signatures = await connection.getSignaturesForAddress(new PublicKey(wallet), options, "confirmed");
    } catch {
      return;
    }

    for (const item of signatures) {
      const blockTime = item.blockTime ?? 0;
      const previous = signatureMap.get(item.signature);
      if (previous === undefined || blockTime > previous) {
        signatureMap.set(item.signature, blockTime);
      }
    }
  });

  return [...signatureMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxSignatures)
    .map(([signature]) => signature);
};

export const collectTransferEventsForMint = async (
  mint: PublicKey,
  wallets: string[],
  txLimit: number,
  maxSignatures: number
): Promise<TransferEvent[]> => {
  if (wallets.length === 0) {
    return [];
  }

  const signatures = await collectRecentSignatures(wallets, txLimit, maxSignatures);
  if (signatures.length === 0) {
    return [];
  }

  const connection = getConnection();
  const transactions: ParsedTransactionWithMeta[] = [];
  for (let i = 0; i < signatures.length; i += 25) {
    const txChunk = signatures.slice(i, i + 25);
    const parsedChunk = await connection.getParsedTransactions(txChunk, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });

    for (const tx of parsedChunk) {
      if (tx) {
        transactions.push(tx);
      }
    }
  }

  const targetMint = mint.toBase58();
  const transferEvents: TransferEvent[] = [];

  for (const tx of transactions) {
    const signature = tx.transaction.signatures[0];
    if (!signature) {
      continue;
    }

    const tokenMetadata = extractTokenAccountMetadata(tx);
    const instructions = extractParsedInstructions(tx);

    for (const instruction of instructions) {
      const parsed = instruction.parsed;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const parsedData = parsed as { type?: string; info?: Record<string, unknown> };
      const instructionType = parsedData.type?.toLowerCase() ?? "";
      if (!instructionType.startsWith("transfer")) {
        continue;
      }

      const info = parsedData.info;
      if (!info) {
        continue;
      }

      const source = typeof info.source === "string" ? info.source : null;
      const destination = typeof info.destination === "string" ? info.destination : null;

      if (!source || !destination) {
        continue;
      }

      const amountRaw = parseAmountRaw(info);
      if (amountRaw === null || amountRaw <= 0n) {
        continue;
      }

      const sourceMeta = tokenMetadata.get(source);
      const destinationMeta = tokenMetadata.get(destination);

      const transferMint =
        (typeof info.mint === "string" ? info.mint : null) ?? sourceMeta?.mint ?? destinationMeta?.mint;

      if (!transferMint || transferMint !== targetMint) {
        continue;
      }

      const fromOwner = sourceMeta?.owner;
      const toOwner = destinationMeta?.owner;
      if (!fromOwner || !toOwner || fromOwner === toOwner) {
        continue;
      }

      transferEvents.push({
        signature,
        from: fromOwner,
        to: toOwner,
        amountRaw
      });
    }
  }

  return transferEvents;
};
