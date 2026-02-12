"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BB_MIN_HOLDING, BB_TOKEN_LINK, BB_TOKEN_MINT } from "@/lib/bb-access";

interface WalletProvider {
  isConnected?: boolean;
  isBackpack?: boolean;
  name?: string;
  providers?: WalletProvider[];
  publicKey?: PublicKey;
  connect: () => Promise<{ publicKey?: PublicKey } | void>;
  disconnect?: () => Promise<void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    solana?: WalletProvider;
    backpack?: {
      solana?: WalletProvider;
    };
  }
}

const RPC_URL = process.env.NEXT_PUBLIC_GORBAGANA_RPC_URL ?? "https://rpc.gorbagana.wtf/";

const formatNumber = (value: number, maxFractionDigits = 2): string => {
  return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
};

const shortenAddress = (value: string): string => {
  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

const isBackpackProvider = (provider: WalletProvider | null | undefined): provider is WalletProvider => {
  if (!provider) {
    return false;
  }

  if (provider.isBackpack) {
    return true;
  }

  return provider.name?.toLowerCase() === "backpack";
};

const getBackpackProvider = (): WalletProvider | null => {
  if (typeof window === "undefined") {
    return null;
  }

  if (isBackpackProvider(window.backpack?.solana)) {
    return window.backpack?.solana ?? null;
  }

  const topLevel = window.solana;
  if (!topLevel) {
    return null;
  }

  if (Array.isArray(topLevel.providers)) {
    const backpack = topLevel.providers.find((provider) => isBackpackProvider(provider));
    if (backpack) {
      return backpack;
    }
  }

  return isBackpackProvider(topLevel) ? topLevel : null;
};

export function AccessGate({ children }: { children: React.ReactNode }): JSX.Element {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [bbBalance, setBbBalance] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  const fetchBbBalance = useCallback(
    async (wallet: PublicKey): Promise<number> => {
      let total = 0;

      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const response = await connection.getParsedTokenAccountsByOwner(wallet, { programId }, "confirmed");

        for (const account of response.value) {
          const parsedData = account.account.data;
          if (!parsedData || typeof parsedData !== "object" || !("parsed" in parsedData)) {
            continue;
          }

          const parsed = parsedData.parsed as { info?: { mint?: string; tokenAmount?: { uiAmount?: number; uiAmountString?: string } } };
          if (parsed.info?.mint !== BB_TOKEN_MINT) {
            continue;
          }

          const amountString = parsed.info.tokenAmount?.uiAmountString;
          if (typeof amountString === "string") {
            total += Number.parseFloat(amountString);
            continue;
          }

          total += parsed.info.tokenAmount?.uiAmount ?? 0;
        }
      }

      return total;
    },
    [connection]
  );

  const evaluateAccess = useCallback(
    async (wallet: PublicKey): Promise<void> => {
      setIsChecking(true);
      setError(null);

      try {
        const totalBb = await fetchBbBalance(wallet);
        setBbBalance(totalBb);
        setAccessGranted(totalBb >= BB_MIN_HOLDING);
      } catch (accessError) {
        setAccessGranted(false);
        const message = accessError instanceof Error ? accessError.message : "Failed to verify BB balance";
        setError(message);
      } finally {
        setIsChecking(false);
      }
    },
    [fetchBbBalance]
  );

  const resetState = useCallback(() => {
    setWalletAddress(null);
    setBbBalance(null);
    setAccessGranted(false);
    setIsChecking(false);
    setError(null);
  }, []);

  const connectAndCheck = useCallback(async () => {
    const provider = getBackpackProvider();
    if (!provider) {
      setError("Backpack wallet not found. Install Backpack and use it for this site.");
      return;
    }

    setError(null);
    setIsChecking(true);

    try {
      const result = await provider.connect();
      const connected = result?.publicKey ?? provider.publicKey;
      if (!connected) {
        throw new Error("Wallet connected, but no public key was returned.");
      }

      setWalletAddress(connected.toBase58());
      await evaluateAccess(connected);
    } catch (connectError) {
      setIsChecking(false);
      const message = connectError instanceof Error ? connectError.message : "Failed to connect wallet";
      setError(message);
      setAccessGranted(false);
    }
  }, [evaluateAccess]);

  const disconnectWallet = useCallback(async () => {
    const provider = getBackpackProvider();
    if (provider?.disconnect) {
      try {
        await provider.disconnect();
      } catch {
        // Ignore provider disconnect errors and reset local gate state.
      }
    }

    resetState();
  }, [resetState]);

  useEffect(() => {
    const provider = getBackpackProvider();
    if (!provider) {
      return;
    }

    if (provider.isConnected && provider.publicKey) {
      setWalletAddress(provider.publicKey.toBase58());
      void evaluateAccess(provider.publicKey);
    }

    const handleAccountChanged = (...args: unknown[]): void => {
      const next = args[0];
      if (!(next instanceof PublicKey)) {
        resetState();
        return;
      }

      setWalletAddress(next.toBase58());
      void evaluateAccess(next);
    };

    const handleDisconnect = (): void => {
      resetState();
    };

    provider.on?.("accountChanged", handleAccountChanged);
    provider.on?.("disconnect", handleDisconnect);

    return () => {
      provider.off?.("accountChanged", handleAccountChanged);
      provider.off?.("disconnect", handleDisconnect);
    };
  }, [evaluateAccess, resetState]);

  if (accessGranted) {
    return <>{children}</>;
  }

  const remaining = Math.max(0, BB_MIN_HOLDING - (bbBalance ?? 0));

  return (
    <main className="accessGateShell">
      <section className="accessGateCard">
        <img src="/bbubble-logo.png" alt="BB Tools logo" className="brandLogo" />
        <p className="brandKicker">HOLDER ACCESS ONLY</p>
        <h1>BB Tools</h1>
        <p className="heroSubtext">
          Connect your Backpack wallet holding at least <strong>{formatNumber(BB_MIN_HOLDING, 0)} $BB</strong> to
          access the app.
        </p>
        <p className="detailSub">
          Token:{" "}
          <a className="walletLink" href={BB_TOKEN_LINK} target="_blank" rel="noreferrer noopener">
            {shortenAddress(BB_TOKEN_MINT)}
          </a>
        </p>

        {walletAddress && (
          <p className="detailSub">
            Wallet: <span className="mono">{shortenAddress(walletAddress)}</span>
          </p>
        )}
        {bbBalance !== null && (
          <p className="detailSub">
            Balance: <strong>{formatNumber(bbBalance, 2)} $BB</strong>
          </p>
        )}
        {bbBalance !== null && bbBalance < BB_MIN_HOLDING && (
          <p className="errorText">Need {formatNumber(remaining, 2)} more $BB to unlock access.</p>
        )}
        {error && <p className="errorText">{error}</p>}

        <div className="accessGateActions">
          <button onClick={() => void connectAndCheck()} disabled={isChecking}>
            {isChecking ? "CHECKING..." : walletAddress ? "RECHECK ACCESS" : "CONNECT BACKPACK"}
          </button>
          {walletAddress && (
            <button className="accessSecondaryButton" onClick={() => void disconnectWallet()} disabled={isChecking}>
              DISCONNECT
            </button>
          )}
          <a
            className="accessBuyLink"
            href="https://trashbin.fun/trap?from=So11111111111111111111111111111111111111112&to=APxsyvmenL6WxTS8f4JUZ2wtimgyTwywNC1bdNoRwi5d"
            target="_blank"
            rel="noreferrer noopener"
          >
            Dont have $BB? buy it here
          </a>
        </div>
      </section>
    </main>
  );
}
