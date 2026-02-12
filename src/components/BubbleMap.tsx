import { useMemo } from "react";
import type { SnapshotEdge, SnapshotNode } from "@/lib/types";

const WIDTH = 1060;
const HEIGHT = 620;
const PADDING = 56;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

interface PositionedNode extends SnapshotNode {
  x: number;
  y: number;
  radius: number;
}

interface BubbleMapProps {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
  minPct: number;
  minEdgeAmount: number;
  showConnections: boolean;
  selectedAddress?: string | null;
  selectedClusterAddresses?: Set<string>;
  onSelectNode?: (address: string) => void;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const shorten = (address: string): string => {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
};

export function BubbleMap({
  nodes,
  edges,
  minPct,
  minEdgeAmount,
  showConnections,
  selectedAddress,
  selectedClusterAddresses,
  onSelectNode
}: BubbleMapProps): JSX.Element {
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => node.pctSupply >= minPct);
  }, [nodes, minPct]);

  const positionedNodes = useMemo<PositionedNode[]>(() => {
    if (filteredNodes.length === 0) {
      return [];
    }

    const maxBalance = Math.max(...filteredNodes.map((node) => node.balance), 1);

    return filteredNodes.map((node, index) => {
      const ratio = node.balance / maxBalance;
      const radius = 10 + Math.sqrt(ratio) * 52;
      const angle = index * GOLDEN_ANGLE;
      const distance = 18 + Math.sqrt(index + 1) * 34;

      const x = clamp(WIDTH / 2 + Math.cos(angle) * distance, PADDING, WIDTH - PADDING);
      const y = clamp(HEIGHT / 2 + Math.sin(angle) * distance, PADDING, HEIGHT - PADDING);

      return {
        ...node,
        x,
        y,
        radius
      };
    });
  }, [filteredNodes]);

  const nodeByAddress = useMemo(() => {
    return new Map(positionedNodes.map((node) => [node.address, node]));
  }, [positionedNodes]);

  const filteredEdges = useMemo(() => {
    return edges.filter((edge) => {
      if (edge.amountSum < minEdgeAmount) {
        return false;
      }

      return nodeByAddress.has(edge.from) && nodeByAddress.has(edge.to);
    });
  }, [edges, minEdgeAmount, nodeByAddress]);

  const maxEdge = useMemo(() => {
    return Math.max(...filteredEdges.map((edge) => edge.amountSum), 1);
  }, [filteredEdges]);

  const hasSelection = Boolean(selectedAddress);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mapCanvas" role="img" aria-label="Token holder bubble map">
      <defs>
        <radialGradient id="bubbleGradient" cx="45%" cy="38%" r="68%">
          <stop offset="0%" stopColor="#fff8d2" stopOpacity="0.97" />
          <stop offset="52%" stopColor="#facc15" stopOpacity="0.92" />
          <stop offset="100%" stopColor="#ca8a04" stopOpacity="0.88" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="url(#mapBackground)" opacity={0} />

      {showConnections &&
        filteredEdges.map((edge) => {
          const from = nodeByAddress.get(edge.from);
          const to = nodeByAddress.get(edge.to);

          if (!from || !to) {
            return null;
          }

          const strokeWidth = 0.6 + (Math.log10(1 + edge.amountSum) / Math.log10(1 + maxEdge)) * 4;
          const edgeInCluster =
            selectedClusterAddresses &&
            selectedClusterAddresses.has(edge.from) &&
            selectedClusterAddresses.has(edge.to);
          const connectedToSelected = Boolean(selectedAddress && (edge.from === selectedAddress || edge.to === selectedAddress));

          const strokeOpacity = !hasSelection ? 0.34 : edgeInCluster ? 0.43 : 0.06;

          return (
            <line
              key={`${edge.from}:${edge.to}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={connectedToSelected ? "#fde047" : "#facc15"}
              strokeOpacity={connectedToSelected ? 0.58 : strokeOpacity}
              strokeWidth={connectedToSelected ? strokeWidth + 0.6 : strokeWidth}
            >
              <title>{`${shorten(edge.from)} -> ${shorten(edge.to)} | ${edge.amountSum.toFixed(4)} (${edge.txCount} tx)`}</title>
            </line>
          );
        })}

      {positionedNodes.map((node, nodeIndex) => {
        const animationDuration = 4.8 + (nodeIndex % 7) * 0.35;
        const animationDelay = -1 * (nodeIndex % 11) * 0.4;
        const inSelectedCluster = selectedClusterAddresses?.has(node.address) ?? false;
        const isSelected = selectedAddress === node.address;

        const fillOpacity = !hasSelection ? 0.9 : inSelectedCluster ? 0.95 : 0.2;
        const strokeOpacity = !hasSelection ? 0.42 : isSelected ? 0.96 : inSelectedCluster ? 0.58 : 0.12;
        const strokeWidth = isSelected ? 2.4 : inSelectedCluster ? 1.4 : 1;

        return (
          <g
            key={node.address}
            className="mapNode floatingNode"
            role="button"
            tabIndex={0}
            style={{
              animationDuration: `${animationDuration}s`,
              animationDelay: `${animationDelay}s`
            }}
            onClick={() => onSelectNode?.(node.address)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectNode?.(node.address);
              }
            }}
            aria-label={`Select wallet ${node.address}`}
          >
            <circle cx={node.x} cy={node.y} r={node.radius} fill="url(#bubbleGradient)" fillOpacity={fillOpacity} />
            <circle
              cx={node.x}
              cy={node.y}
              r={node.radius}
              fill="none"
              stroke={isSelected ? "#fef9c3" : "#fef08a"}
              strokeOpacity={strokeOpacity}
              strokeWidth={strokeWidth}
            />
            <title>{`${node.address}\nBalance: ${node.balance.toFixed(4)}\nSupply: ${node.pctSupply.toFixed(4)}%`}</title>
          </g>
        );
      })}
    </svg>
  );
}
