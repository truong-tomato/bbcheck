import type { Metadata } from "next";
import { AccessGate } from "@/components/AccessGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "BB Check",
  description: "An ultimate onchain tool exclusively for Gorbagana"
};

const isAccessGateEnabled = process.env.ENABLE_BB_ACCESS_GATE === "true";

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>): JSX.Element {
  return (
    <html lang="en">
      <body>{isAccessGateEnabled ? <AccessGate>{children}</AccessGate> : children}</body>
    </html>
  );
}
