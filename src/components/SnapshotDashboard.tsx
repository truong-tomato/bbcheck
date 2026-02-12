"use client";

import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BubbleMap } from "@/components/BubbleMap";
import { BubbleLoader } from "@/components/BubbleLoader";
import type { SnapshotNode, TokenSnapshot } from "@/lib/types";

const DEFAULT_MINT = "";

interface ClusterData {
  id: number;
  nodeAddresses: string[];
  totalPctSupply: number;
  totalBalance: number;
  edgeCount: number;
  transferAmount: number;
}

const shortenAddress = (address: string): string => {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-6)}`;
};

const formatNumber = (value: number, maxFractionDigits = 4): string => {
  return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
};

export function SnapshotDashboard(): JSX.Element {
  const [mintInput, setMintInput] = useState(DEFAULT_MINT);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    const mint = mintInput.trim();
    if (!mint) {
      setError("Mint address is required.");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        mint,
        n: "120",
        edgeWallets: "30",
        txLimit: "120",
        refresh: "1"
      });

      const response = await fetch(`/api/snapshot?${params.toString()}`, {
        cache: "no-store"
      });

      const payload = (await response.json()) as TokenSnapshot | { error: string };
      if (!response.ok) {
        const message = "error" in payload ? payload.error : "Scan request failed";
        throw new Error(message);
      }

      const nextSnapshot = payload as TokenSnapshot;
      setSnapshot(nextSnapshot);
      setSelectedWallet(nextSnapshot.nodes[0]?.address ?? null);
      setLastUpdatedAt(Date.now());
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : "Failed to scan mint";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [mintInput]);

  const detailCards = useMemo(() => {
    const topHolder = snapshot?.nodes[0];

    return [
      {
        label: "Token",
        value: snapshot?.tokenName ?? "Unknown",
        sub: snapshot?.tokenSymbol ? `$${snapshot.tokenSymbol}` : "No symbol"
      },
      {
        label: "Total Supply",
        value: snapshot ? formatNumber(snapshot.supply, 6) : "-",
        sub: snapshot ? `${snapshot.decimals} decimals` : ""
      },
      {
        label: "Program",
        value: snapshot?.tokenProgram ?? "-",
        sub: snapshot?.mint ? shortenAddress(snapshot.mint) : ""
      },
      {
        label: "Top Holder",
        value: topHolder ? `${topHolder.pctSupply.toFixed(2)}%` : "-",
        sub: topHolder ? shortenAddress(topHolder.address) : ""
      },
      {
        label: "Holders Mapped",
        value: snapshot ? String(snapshot.nodes.length) : "-",
        sub: "bubble nodes"
      },
      {
        label: "Connections",
        value: snapshot ? String(snapshot.edges.length) : "-",
        sub: "transfer edges"
      }
    ];
  }, [snapshot]);

  const clusterGraph = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    const adjacency = new Map<string, Set<string>>();
    const nodeByAddress = new Map(snapshot.nodes.map((node) => [node.address, node]));

    for (const node of snapshot.nodes) {
      adjacency.set(node.address, new Set());
    }

    for (const edge of snapshot.edges) {
      if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
        continue;
      }

      adjacency.get(edge.from)?.add(edge.to);
      adjacency.get(edge.to)?.add(edge.from);
    }

    const visited = new Set<string>();
    const clusters: ClusterData[] = [];
    const nodeToCluster = new Map<string, ClusterData>();

    for (const node of snapshot.nodes) {
      if (visited.has(node.address)) {
        continue;
      }

      const stack = [node.address];
      const members: string[] = [];

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || visited.has(current)) {
          continue;
        }

        visited.add(current);
        members.push(current);

        const neighbors = adjacency.get(current);
        if (!neighbors) {
          continue;
        }

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor);
          }
        }
      }

      const memberSet = new Set(members);
      const clusterEdges = snapshot.edges.filter((edge) => memberSet.has(edge.from) && memberSet.has(edge.to));
      const clusterNodes = members
        .map((address) => nodeByAddress.get(address))
        .filter((clusterNode): clusterNode is SnapshotNode => Boolean(clusterNode));

      const clusterData: ClusterData = {
        id: clusters.length + 1,
        nodeAddresses: members,
        totalPctSupply: clusterNodes.reduce((sum, clusterNode) => sum + clusterNode.pctSupply, 0),
        totalBalance: clusterNodes.reduce((sum, clusterNode) => sum + clusterNode.balance, 0),
        edgeCount: clusterEdges.length,
        transferAmount: clusterEdges.reduce((sum, edge) => sum + edge.amountSum, 0)
      };

      clusters.push(clusterData);
      for (const address of members) {
        nodeToCluster.set(address, clusterData);
      }
    }

    return { clusters, nodeToCluster, nodeByAddress };
  }, [snapshot]);

  const selectedNode = useMemo(() => {
    if (!snapshot || !selectedWallet) {
      return null;
    }

    return snapshot.nodes.find((node) => node.address === selectedWallet) ?? null;
  }, [selectedWallet, snapshot]);

  const selectedCluster = useMemo(() => {
    if (!clusterGraph || !selectedWallet) {
      return null;
    }

    return clusterGraph.nodeToCluster.get(selectedWallet) ?? null;
  }, [clusterGraph, selectedWallet]);

  const selectedClusterSet = useMemo(() => {
    if (!selectedCluster) {
      return undefined;
    }

    return new Set(selectedCluster.nodeAddresses);
  }, [selectedCluster]);

  const selectedClusterNodes = useMemo(() => {
    if (!selectedCluster || !clusterGraph) {
      return [];
    }

    return selectedCluster.nodeAddresses
      .map((address) => clusterGraph.nodeByAddress.get(address))
      .filter((node): node is SnapshotNode => Boolean(node))
      .sort((a, b) => b.balance - a.balance);
  }, [clusterGraph, selectedCluster]);

  return (
    <main className="pageShell">
      <section className="heroScan">
        <AppHeader activeTool="bubblemap" />

        <p className="heroSubtext">
          BBubblemap gives instant token concentration mapping with glowing bubble clusters and ownership transfer links.
        </p>

        <div className="scanHeroBox">
          <label htmlFor="mint-input">Mint address</label>
          <div className="scanRow">
            <input
              id="mint-input"
              value={mintInput}
              onChange={(event) => setMintInput(event.target.value)}
              placeholder="Paste token mint address"
            />
            <button onClick={() => void fetchSnapshot()} disabled={isLoading}>
              {isLoading ? "SCANNING..." : "SCAN"}
            </button>
          </div>
          <label className="scanCheck">
            <input
              type="checkbox"
              checked={showConnections}
              onChange={(event) => setShowConnections(event.target.checked)}
            />
            Show transfer connections
          </label>
          <p className="scanStamp">{lastUpdatedAt ? `Last scan ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ""}</p>
        </div>
      </section>

      {error && <p className="errorText">{error}</p>}

      <section className="detailGrid">
        {detailCards.map((card) => (
          <article key={card.label} className="detailCard">
            <p className="detailLabel">{card.label}</p>
            <p className="detailValue">{card.value}</p>
            <p className="detailSub">{card.sub}</p>
          </article>
        ))}
      </section>

      <section className="mapPanel">
        <div className="mapStage">
          {snapshot ? (
            <BubbleMap
              nodes={snapshot.nodes}
              edges={snapshot.edges}
              minPct={0}
              minEdgeAmount={0}
              showConnections={showConnections}
              selectedAddress={selectedWallet}
              selectedClusterAddresses={selectedClusterSet}
              onSelectNode={setSelectedWallet}
            />
          ) : (
            <p className="emptyHint">Run SCAN to render the bubble map.</p>
          )}

          {isLoading && (
            <div className="mapOverlay">
              <BubbleLoader label="Scanning token state..." />
            </div>
          )}
        </div>
      </section>

      <section className="inspectorPanel">
        <div className="inspectorHead">
          <h2>Cluster Inspector</h2>
          <p>Click a bubble to inspect the wallet and its connected cluster.</p>
        </div>

        {!snapshot && <p className="inspectorHint">Run SCAN to enable interaction.</p>}

        {snapshot && !selectedNode && <p className="inspectorHint">Select a bubble on the map to inspect it.</p>}

        {snapshot && selectedNode && selectedCluster && (
          <>
            <div className="inspectorStats">
              <article>
                <p>Selected Wallet</p>
                <a
                  className="walletLink"
                  href={`https://trashscan.io/address/${selectedNode.address}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {shortenAddress(selectedNode.address)}
                </a>
                <strong>{selectedNode.pctSupply.toFixed(4)}% supply</strong>
              </article>
              <article>
                <p>Cluster Share</p>
                <strong>{selectedCluster.totalPctSupply.toFixed(4)}%</strong>
                <span>{formatNumber(selectedCluster.totalBalance, 6)} tokens</span>
              </article>
              <article>
                <p>Cluster Size</p>
                <strong>{selectedCluster.nodeAddresses.length} wallets</strong>
                <span>{selectedCluster.edgeCount} internal edges</span>
              </article>
              <article>
                <p>Internal Flow</p>
                <strong>{formatNumber(selectedCluster.transferAmount, 6)}</strong>
                <span>sum transfer amount</span>
              </article>
            </div>

            <div className="clusterWallets">
              <h3>Wallets In Selected Cluster</h3>
              <ul>
                {selectedClusterNodes.map((node) => (
                  <li key={node.address}>
                    <a
                      className="walletLink"
                      href={`https://trashscan.io/address/${node.address}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {shortenAddress(node.address)}
                    </a>
                    <span>{node.pctSupply.toFixed(4)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {snapshot && (
        <section className="tablesGrid">
          <article className="tableCard">
            <h2>Top Holders</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th>Balance</th>
                    <th>% Supply</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.nodes.slice(0, 25).map((node) => (
                    <tr key={node.address}>
                      <td>
                        <a
                          className="walletLink"
                          href={`https://trashscan.io/address/${node.address}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={node.address}
                        >
                          {shortenAddress(node.address)}
                        </a>
                      </td>
                      <td>{formatNumber(node.balance, 6)}</td>
                      <td>{node.pctSupply.toFixed(4)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="tableCard">
            <h2>Wallet Connections</h2>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Amount</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.edges.slice(0, 25).map((edge) => (
                    <tr key={`${edge.from}:${edge.to}`}>
                      <td>
                        <a
                          className="walletLink"
                          href={`https://trashscan.io/address/${edge.from}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={edge.from}
                        >
                          {shortenAddress(edge.from)}
                        </a>
                      </td>
                      <td>
                        <a
                          className="walletLink"
                          href={`https://trashscan.io/address/${edge.to}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={edge.to}
                        >
                          {shortenAddress(edge.to)}
                        </a>
                      </td>
                      <td>{formatNumber(edge.amountSum, 6)}</td>
                      <td>{edge.txCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
