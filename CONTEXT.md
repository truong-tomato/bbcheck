# Token Holder Bubblemap MVP  
**Next.js + Gorbagana (Solana-style RPC) — Snapshot Bubble + Connections**

## 1. Project Goal

Build an MVP web app that visualizes **token holders as bubbles** and **transfer relationships as connections (edges)** for a given token mint on a Solana-style chain (Gorbagana).

This is a **snapshot system (no realtime updates)**.

**Input:**  
- Token mint address

**Output:**  
- Bubble graph of top holders  
- Optional connections between holders based on recent transfers  

---

## 2. Tech Stack

**Frontend**
- Next.js (App Router)
- Graph visualization: Sigma.js or react-force-graph

**Backend**
- Next.js Route Handlers (`/app/api/snapshot/route.ts`)
- RPC client (Solana-style, adapted for Gorbagana)
- Simple caching (SQLite / Prisma or JSON in dev)

**Web3**
- `@solana/web3.js`
- `@solana/spl-token`

---

## 3. High-Level Architecture

```
User → Next.js Frontend
          ↓
   /api/snapshot?mint=...
          ↓
     Snapshot Builder
          ↓
   Gorbagana RPC Endpoint
```

---

## 4. API Contract

### Endpoint

`GET /api/snapshot?mint=<MINT_ADDRESS>&n=200`

### Response Format

```json
{
  "mint": "MINT_ADDRESS",
  "supply": 1000000000,
  "decimals": 9,
  "nodes": [
    {
      "address": "wallet1",
      "balance": 1234.56,
      "pctSupply": 1.23
    }
  ],
  "edges": [
    {
      "from": "walletA",
      "to": "walletB",
      "amountSum": 999.12,
      "txCount": 7
    }
  ],
  "timestamp": 1712345678
}
```

---

## 5. Snapshot Builder Logic

### Step A — Fetch Holders (Bubbles)

1. Fetch token supply and decimals from mint account  
2. Fetch token accounts for the mint  
3. Decode token accounts to get:
   - owner wallet
   - token amount  
4. Aggregate balances by owner  
5. Sort descending  
6. Take top N holders (default: 100–300)  
7. Compute `% of total supply` per holder  

**Node schema:**
```ts
{
  address: string;
  balance: number;
  pctSupply: number;
}
```

---

### Step B — Build Connections (Edges)

For top M holders (e.g. 50):

1. Fetch recent transaction signatures for each wallet (cap: 200–500)  
2. Fetch transaction details  
3. Parse token transfer instructions  
4. If transfer mint == target mint:
   - map token accounts → owner wallets  
   - record transfer edge  
5. Only keep edges where both sides are in top N holders  
6. Aggregate:
   - total amount transferred  
   - number of transfers  

**Edge schema:**
```ts
{
  from: string;
  to: string;
  amountSum: number;
  txCount: number;
}
```

---

## 6. Performance Constraints (MVP)

- Max holders: 200  
- Max wallets scanned for edges: 50  
- Max tx per wallet: 300  
- Cache snapshot for 30–120 minutes  
- Add manual refresh endpoint for debugging  

---

## 7. Next.js Backend Skeleton

```ts
// app/api/snapshot/route.ts

import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mint = searchParams.get("mint");

  if (!mint) {
    return NextResponse.json({ error: "Missing mint" }, { status: 400 });
  }

  const snapshot = await buildSnapshot(mint);

  return NextResponse.json(snapshot);
}
```

---

## 8. Frontend Requirements

- Input: mint address  
- Button: "Generate Snapshot"  
- Bubble size = holder balance  
- Optional toggle: show connections  
- Filters:
  - min % supply  
  - min edge weight  
- Tooltip: wallet, balance, % supply  

---

## 9. AI Layer (Optional, Post-MVP)

Use AI only on **aggregated features**, not raw tx data.

Example AI outputs:
- “Likely distribution wallet”  
- “High centralization risk”  
- “Cluster looks exchange-like”  

Input features for AI:
- cluster size  
- fan-in / fan-out ratio  
- internal transfer %  
- top counterparties  

---

## 10. Non-Goals (for MVP)

- No realtime websocket subscriptions  
- No full-chain historical indexing  
- No wallet labeling from external APIs  
- No user accounts  

---

## 11. Code Style & Guidance for Codex

- Write modular snapshot builder: `buildSnapshot(mint)`  
- Separate RPC layer from business logic  
- Make limits configurable  
- Prefer simple, readable code over performance tricks  
- Assume Solana-style RPC semantics for Gorbagana  

---

## 12. Future Extensions

- Clustering (Louvain/Leiden)  
- Historical snapshots  
- Compare two snapshots  
- Alert on concentration changes  
- Export CSV / JSON  
