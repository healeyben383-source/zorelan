import { NextRequest, NextResponse } from "next/server";

/**
 * app/api/verify/route.ts
 *
 * Thin server-side wrapper around /api/decision.
 *
 * The UI calls this endpoint without auth. This route forwards the request
 * to /api/decision server-side using the master key, so the key never
 * reaches the browser.
 *
 * Request shape (from UI):
 *   POST /api/verify
 *   { prompt: string, cache_bypass?: boolean }
 *
 * Response shape:
 *   Passes through the /api/decision response unchanged.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body?.prompt || typeof body.prompt !== "string") {
      return NextResponse.json(
        { ok: false, error: "missing_prompt" },
        { status: 400 }
      );
    }

    const masterKey = process.env.DECISION_API_KEY;

    if (!masterKey) {
      console.error("[/api/verify] DECISION_API_KEY not set");
      return NextResponse.json(
        { ok: false, error: "server_configuration_error" },
        { status: 500 }
      );
    }

    // Build the internal URL — works in both local and Vercel environments
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ??
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

    const decisionRes = await fetch(`${baseUrl}/api/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${masterKey}`,
      },
      body: JSON.stringify({
        prompt: body.prompt,
        cache_bypass: body.cache_bypass ?? false,
      }),
    });

    const decisionJson = await decisionRes.json().catch(() => null);

    if (!decisionJson) {
      return NextResponse.json(
        { ok: false, error: "decision_parse_error" },
        { status: 500 }
      );
    }

    return NextResponse.json(decisionJson, { status: decisionRes.status });
  } catch (err) {
    console.error("[/api/verify] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
