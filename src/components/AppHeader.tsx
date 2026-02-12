"use client";

import Link from "next/link";

type ToolKey = "bubblemap" | "wallet-tracker";

interface AppHeaderProps {
  activeTool: ToolKey;
}

export function AppHeader({ activeTool }: AppHeaderProps): JSX.Element {
  return (
    <header className="appHeader">
      <div className="appHeaderBrand">
        <img src="/bbubble-logo.png" alt="BB Tools logo" className="brandLogo" />
        <div className="appHeaderTitleWrap">
          <h1>BB Tools</h1>
          <p className="brandKicker">An ultimate onchain tool exclusively for Gorbagana</p>
        </div>
      </div>

      <nav className="appToolNav" aria-label="Tool navigation">
        <Link className={`appToolLink ${activeTool === "bubblemap" ? "active" : ""}`} href="/">
          BBubblemap
        </Link>
        <Link
          className={`appToolLink ${activeTool === "wallet-tracker" ? "active" : ""}`}
          href="/high-volume-board"
        >
          BB Wallet Tracker
        </Link>
      </nav>
    </header>
  );
}
