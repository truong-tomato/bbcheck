export interface SnapshotNode {
  address: string;
  balance: number;
  pctSupply: number;
}

export interface SnapshotEdge {
  from: string;
  to: string;
  amountSum: number;
  txCount: number;
}

export type TokenProgramKind = "spl-token" | "token-2022";

export interface TokenSnapshot {
  mint: string;
  tokenProgram: TokenProgramKind;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenUri: string | null;
  supply: number;
  decimals: number;
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  timestamp: number;
}

export interface BuildSnapshotOptions {
  holderLimit?: number;
  edgeWalletLimit?: number;
  txLimit?: number;
  maxSignatures?: number;
}

export interface TransferEvent {
  from: string;
  to: string;
  amountRaw: bigint;
  signature: string;
}

export interface LiveOptions extends BuildSnapshotOptions {
  pollIntervalMs?: number;
  forceRefreshMs?: number;
}
