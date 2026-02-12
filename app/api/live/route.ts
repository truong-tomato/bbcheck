import { NextRequest, NextResponse } from "next/server";
import { appConfig, parseLimitParam } from "@/lib/config";
import { subscribeToLiveSnapshots } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const mint = request.nextUrl.searchParams.get("mint");
  if (!mint) {
    return NextResponse.json({ error: "Missing mint query parameter" }, { status: 400 });
  }

  const options = {
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
    ),
    pollIntervalMs: parseLimitParam(
      request.nextUrl.searchParams.get("pollIntervalMs"),
      appConfig.livePollIntervalMs,
      2000,
      60000
    ),
    forceRefreshMs: parseLimitParam(
      request.nextUrl.searchParams.get("forceRefreshMs"),
      appConfig.liveForceRefreshMs,
      60000,
      3600000
    )
  };

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      send("ready", {
        mint,
        pollIntervalMs: options.pollIntervalMs
      });

      unsubscribe = await subscribeToLiveSnapshots(
        mint,
        options,
        (snapshot) => {
          send("snapshot", snapshot);
        },
        (error) => {
          send("snapshot_error", { message: error.message });
        }
      );

      heartbeat = setInterval(() => {
        send("heartbeat", { timestamp: Date.now() });
      }, appConfig.liveHeartbeatMs);

      request.signal.addEventListener("abort", () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        unsubscribe?.();
        unsubscribe = null;

        try {
          controller.close();
        } catch {
          // no-op: stream may already be closed by client
        }
      });
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      unsubscribe?.();
      unsubscribe = null;
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
