"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";

interface HighVolumeBoardEntry {
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

interface HighVolumeBoardSnapshot {
  timestamp: number;
  entries: HighVolumeBoardEntry[];
  scannedSignatures: number;
  scannedTransactions: number;
  minTotalGor: number;
}

const DEFAULT_MIN_TOTAL_GOR = 25_000;

const formatNumber = (value: number, maxFractionDigits = 4): string => {
  return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
};

const shortenAddress = (address: string): string => {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
};

export function HighVolumeBoard(): JSX.Element {
  const [snapshot, setSnapshot] = useState<HighVolumeBoardSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const fetchBoard = useCallback(async (refresh: boolean) => {
    if (refresh) {
      setIsLoading(true);
    }

    setError(null);

    try {
      const params = new URLSearchParams({
        limit: "40",
        perProgramLimit: "120",
        minTotalGor: String(DEFAULT_MIN_TOTAL_GOR)
      });

      if (refresh) {
        params.set("refresh", "1");
      }

      const response = await fetch(`/api/high-volume?${params.toString()}`, {
        cache: "no-store"
      });

      const payload = (await response.json()) as HighVolumeBoardSnapshot | { error?: string };
      if (!response.ok) {
        throw new Error(payload && "error" in payload ? payload.error ?? "Board request failed" : "Board request failed");
      }

      setSnapshot(payload as HighVolumeBoardSnapshot);
      setLastUpdatedAt(Date.now());
    } catch (boardError) {
      const message = boardError instanceof Error ? boardError.message : "Failed to fetch board";
      setError(message);
    } finally {
      if (refresh) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchBoard(true);
  }, [fetchBoard]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const id = setInterval(() => {
      void fetchBoard(false);
    }, 8_000);

    return () => clearInterval(id);
  }, [autoRefresh, fetchBoard]);

  const summary = useMemo(() => {
    if (!snapshot) {
      return {
        totalBuy: 0,
        totalSell: 0,
        totalVolume: 0
      };
    }

    const totalBuy = snapshot.entries.reduce((sum, entry) => sum + entry.buyVolume, 0);
    const totalSell = snapshot.entries.reduce((sum, entry) => sum + entry.sellVolume, 0);

    return {
      totalBuy,
      totalSell,
      totalVolume: totalBuy + totalSell
    };
  }, [snapshot]);

  return (
    <main className="pageShell">
      <section className="heroScan">
        <AppHeader activeTool="wallet-tracker" />
        <div className="boardControlsWrap">
          <div className="boardActionRow">
            <button onClick={() => void fetchBoard(true)} disabled={isLoading}>
              {isLoading ? "REFRESHING..." : "REFRESH"}
            </button>
            <label className="scanCheck">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              Auto 8s
            </label>
          </div>
        </div>

        <p className="heroSubtext">
          BB Wallet Tracker shows near real-time wallet flow from Bang and Trashbin on-chain activity.
          Only wallets with at least {formatNumber(snapshot?.minTotalGor ?? DEFAULT_MIN_TOTAL_GOR, 0)} GOR traded are shown.
        </p>

        <div className="detailGrid boardSummaryGrid">
          <article className="detailCard">
            <p className="detailLabel">Total Buy (GOR)</p>
            <p className="detailValue">{formatNumber(summary.totalBuy, 2)}</p>
            <p className="detailSub">aggregated quote volume</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Total Sell (GOR)</p>
            <p className="detailValue">{formatNumber(summary.totalSell, 2)}</p>
            <p className="detailSub">aggregated quote volume</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Total Volume (GOR)</p>
            <p className="detailValue">{formatNumber(summary.totalVolume, 2)}</p>
            <p className="detailSub">buy + sell</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Scanned Signatures</p>
            <p className="detailValue">{snapshot?.scannedSignatures ?? "-"}</p>
            <p className="detailSub">recent chain signatures</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Scanned Tx</p>
            <p className="detailValue">{snapshot?.scannedTransactions ?? "-"}</p>
            <p className="detailSub">parsed transactions</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Min Threshold</p>
            <p className="detailValue">{formatNumber(snapshot?.minTotalGor ?? DEFAULT_MIN_TOTAL_GOR, 0)} GOR</p>
            <p className="detailSub">minimum total per wallet</p>
          </article>
          <article className="detailCard">
            <p className="detailLabel">Updated</p>
            <p className="detailValue">{lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "-"}</p>
            <p className="detailSub">local time</p>
          </article>
        </div>
      </section>

      {error && <p className="errorText">{error}</p>}

      <section className="tableCard boardTableCard">
        <h2>Top Active Wallets</h2>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Source</th>
                <th>Wallet</th>
                <th>Buy (GOR)</th>
                <th>Sell (GOR)</th>
                <th>Net (GOR)</th>
                <th>Total (GOR)</th>
                <th>Tokens</th>
                <th>Tx (B/S)</th>
                <th>Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {snapshot?.entries.map((entry, index) => (
                <tr key={`${entry.source}:${entry.wallet}`}>
                  <td>{index + 1}</td>
                  <td>
                    <span className={`sourceBadge ${entry.source === "bang.meme" ? "bang" : "trashbin"}`}>
                      {entry.source}
                    </span>
                  </td>
                  <td>
                    <a
                      className="walletLink"
                      href={`https://trashscan.io/address/${entry.wallet}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={entry.wallet}
                    >
                      {shortenAddress(entry.wallet)}
                    </a>
                  </td>
                  <td>{formatNumber(entry.buyVolume, 2)}</td>
                  <td>{formatNumber(entry.sellVolume, 2)}</td>
                  <td className={entry.netVolume >= 0 ? "netUp" : "netDown"}>{formatNumber(entry.netVolume, 2)}</td>
                  <td>{formatNumber(entry.totalVolume, 2)}</td>
                  <td>{entry.tokenCount}</td>
                  <td>{entry.buyTxCount}/{entry.sellTxCount}</td>
                  <td>{entry.lastActivity ? new Date(entry.lastActivity).toLocaleTimeString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!snapshot?.entries.length && !isLoading && (
            <p className="emptyHint small">
              No wallets reached {formatNumber(snapshot?.minTotalGor ?? DEFAULT_MIN_TOTAL_GOR, 0)} GOR yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
