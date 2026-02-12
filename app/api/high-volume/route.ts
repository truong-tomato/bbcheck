import { NextRequest, NextResponse } from "next/server";
import { buildHighVolumeBoard } from "@/lib/high-volume";

const parseInteger = (value: string | null, fallback: number, min: number, max: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
};

const parseFloatValue = (value: string | null, fallback: number, min: number, max: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
};

const isTrue = (value: string | null): boolean => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limit = parseInteger(request.nextUrl.searchParams.get("limit"), 30, 1, 100);
  const perProgramLimit = parseInteger(request.nextUrl.searchParams.get("perProgramLimit"), 80, 10, 300);
  const minTotalGor = parseFloatValue(request.nextUrl.searchParams.get("minTotalGor"), 25_000, 0, 1_000_000_000);
  const refresh = isTrue(request.nextUrl.searchParams.get("refresh"));

  try {
    const snapshot = await buildHighVolumeBoard(limit, perProgramLimit, refresh, minTotalGor);

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build high volume board";

    return NextResponse.json(
      {
        error: message
      },
      { status: 500 }
    );
  }
}
