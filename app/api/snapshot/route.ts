import { NextRequest, NextResponse } from "next/server";
import { appConfig, parseLimitParam } from "@/lib/config";
import { buildSnapshot, normalizeSnapshotOptions } from "@/lib/snapshot";
import { buildSnapshotCacheKey, getCachedSnapshot, setCachedSnapshot } from "@/lib/snapshot-cache";

const isTruthy = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const mint = request.nextUrl.searchParams.get("mint");

  if (!mint) {
    return NextResponse.json({ error: "Missing mint query parameter" }, { status: 400 });
  }

  const options = normalizeSnapshotOptions({
    holderLimit: parseLimitParam(request.nextUrl.searchParams.get("n"), appConfig.holderLimit, 20, 300),
    edgeWalletLimit: parseLimitParam(
      request.nextUrl.searchParams.get("edgeWallets"),
      appConfig.edgeWalletLimit,
      5,
      80
    ),
    txLimit: parseLimitParam(request.nextUrl.searchParams.get("txLimit"), appConfig.txLimit, 20, 400),
    maxSignatures: parseLimitParam(
      request.nextUrl.searchParams.get("maxSignatures"),
      appConfig.maxSignatures,
      100,
      5000
    )
  });

  const forceRefresh = isTruthy(request.nextUrl.searchParams.get("refresh"));
  const cacheKey = buildSnapshotCacheKey(mint, options);

  try {
    if (!forceRefresh) {
      const cached = getCachedSnapshot(cacheKey);
      if (cached) {
        return NextResponse.json(cached, {
          headers: {
            "Cache-Control": "no-store"
          }
        });
      }
    }

    const snapshot = await buildSnapshot(mint, options);
    setCachedSnapshot(cacheKey, snapshot);

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build snapshot";
    return NextResponse.json(
      {
        error: message
      },
      { status: 500 }
    );
  }
}
