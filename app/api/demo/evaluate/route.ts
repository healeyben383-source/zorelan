/**
 * app/api/demo/evaluate/route.ts
 *
 * Internal, UNAUTHENTICATED demo route for the canonical /demo. It shares the
 * exact same evaluation engine and request schema as the public /v1/evaluate
 * endpoint (lib/evaluate/*) — the only difference is that the demo route skips
 * API-key auth so the public /demo works without exposing a key client-side.
 *
 * Deterministic Stage 0 only; no providers, no secrets, never fabricates a verdict.
 */

import { NextResponse } from "next/server";
import { EvaluateRequestSchema } from "@/lib/evaluate/schema";
import { evaluateActionDeterministic } from "@/lib/evaluate/evaluateAction";
import type { EvaluateRequest } from "@/lib/evaluate/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = EvaluateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_failed",
        issues: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const result = evaluateActionDeterministic(parsed.data as EvaluateRequest);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[/api/demo/evaluate] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
