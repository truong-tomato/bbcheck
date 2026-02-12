import { appConfig } from "@/lib/config";
import { toPctSupply, toUiAmount } from "@/lib/math";
import {
  collectTransferEventsForMint,
  fetchHolderBalancesByOwner,
  fetchMintMetadata,
  toPublicKey
} from "@/lib/rpc";
import type { BuildSnapshotOptions, SnapshotEdge, SnapshotNode, TokenSnapshot } from "@/lib/types";

export const normalizeSnapshotOptions = (options: BuildSnapshotOptions = {}): Required<BuildSnapshotOptions> => {
  return {
    holderLimit: options.holderLimit ?? appConfig.holderLimit,
    edgeWalletLimit: options.edgeWalletLimit ?? appConfig.edgeWalletLimit,
    txLimit: options.txLimit ?? appConfig.txLimit,
    maxSignatures: options.maxSignatures ?? appConfig.maxSignatures
  };
};

export const buildSnapshot = async (
  mintAddress: string,
  options: BuildSnapshotOptions = {}
): Promise<TokenSnapshot> => {
  const normalizedOptions = normalizeSnapshotOptions(options);
  const mint = toPublicKey(mintAddress);

  const mintMetadata = await fetchMintMetadata(mint);
  const holderBalances = await fetchHolderBalancesByOwner(mint, mintMetadata.tokenProgramId);

  const sortedHolders = [...holderBalances.entries()].sort((a, b) => {
    if (a[1] === b[1]) {
      return 0;
    }

    return a[1] > b[1] ? -1 : 1;
  });

  const nodes: SnapshotNode[] = sortedHolders.slice(0, normalizedOptions.holderLimit).map(([address, balanceRaw]) => {
    const balance = toUiAmount(balanceRaw, mintMetadata.decimals);

    return {
      address,
      balance,
      pctSupply: toPctSupply(balance, mintMetadata.supply)
    };
  });

  const topWalletsForEdges = nodes.slice(0, normalizedOptions.edgeWalletLimit).map((node) => node.address);
  const transferEvents = await collectTransferEventsForMint(
    mint,
    topWalletsForEdges,
    normalizedOptions.txLimit,
    normalizedOptions.maxSignatures
  );

  const includedWallets = new Set(nodes.map((node) => node.address));
  const edgeMap = new Map<string, { from: string; to: string; amountRaw: bigint; txCount: number }>();

  for (const event of transferEvents) {
    if (!includedWallets.has(event.from) || !includedWallets.has(event.to)) {
      continue;
    }

    const key = `${event.from}:${event.to}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, {
        from: event.from,
        to: event.to,
        amountRaw: event.amountRaw,
        txCount: 1
      });
      continue;
    }

    existing.amountRaw += event.amountRaw;
    existing.txCount += 1;
  }

  const edges: SnapshotEdge[] = [...edgeMap.values()]
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      txCount: edge.txCount,
      amountSum: toUiAmount(edge.amountRaw, mintMetadata.decimals)
    }))
    .sort((a, b) => {
      if (a.amountSum === b.amountSum) {
        return b.txCount - a.txCount;
      }

      return b.amountSum - a.amountSum;
    });

  return {
    mint: mint.toBase58(),
    tokenProgram: mintMetadata.tokenProgram,
    tokenName: mintMetadata.tokenName,
    tokenSymbol: mintMetadata.tokenSymbol,
    tokenUri: mintMetadata.tokenUri,
    supply: mintMetadata.supply,
    decimals: mintMetadata.decimals,
    nodes,
    edges,
    timestamp: Date.now()
  };
};
