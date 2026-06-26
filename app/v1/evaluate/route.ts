/**
 * app/v1/evaluate/route.ts
 *
 * Public, authenticated execution-gate endpoint.
 *
 *   POST /v1/evaluate
 *
 * Accepts a structured { proposed_action, policy, ... } payload and returns a
 * decision-first ALLOW / REVIEW / BLOCK result. Deterministic Stage 0 only in
 * this pass — see MODEL_JUDGEMENT_TODO in lib/evaluate/evaluateAction.ts.
 *
 * This is a NEW, additive endpoint. It does not touch /v1/decision,
 * /api/decision, or the legacy verify(prompt) path.
 *
 * Auth + usage reuse the same key model as /api/decision via lib/evaluate/
 * apiKeyAuth.ts (master key or per-customer Redis key, plan call limits, optional
 * rate limiting). A malformed body is rejected BEFORE any usage is consumed.
 * Fails closed: invalid/missing keys are rejected; unexpected errors return a
 * clear 500 and never a fabricated ALLOW.
 */

import { NextResponse } from "next/server";
import { authorizeRequest, accountUsage } from "@/lib/evaluate/apiKeyAuth";
import { EvaluateRequestSchema } from "@/lib/evaluate/schema";
import { evaluateActionDeterministic } from "@/lib/evaluate/evaluateAction";
import {
  buildDecisionRecord,
  generateDecisionId,
} from "@/lib/evaluate/decisionRecord";
import type { EvaluateRequest } from "@/lib/evaluate/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // ── Phase 1: authorize (no usage consumed yet) ──────────────────────────────
  const auth = await authorizeRequest(req);
  if (!auth.ok) {
    const headers = auth.retryAfter
      ? { "Retry-After": String(auth.retryAfter) }
      : undefined;
    return NextResponse.json(
      {
        ok: false,
        error: auth.error,
        ...(auth.scope ? { scope: auth.scope } : {}),
        ...(auth.retryAfter ? { retry_after: auth.retryAfter } : {}),
        ...(auth.extra ?? {}),
      },
      { status: auth.status, ...(headers ? { headers } : {}) }
    );
  }

  // ── Parse + validate body ───────────────────────────────────────────────────
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

  // ── Phase 2: account usage (only now that the request is valid) ──────────────
  let usage = null;
  if (!auth.isMaster) {
    usage = await accountUsage(auth.token, auth.record);
  }

  // ── Evaluate (deterministic Stage 0) ────────────────────────────────────────
  // Decision Record V1 (additive, return-only): identify, timestamp, and project
  // the decision. The flat fields stay the source of truth; the record is built
  // here (not in the pure engine) so the engine remains deterministic/replayable.
  const decisionId = generateDecisionId();
  const startedAt = Date.now();
  try {
    const result = evaluateActionDeterministic(parsed.data as EvaluateRequest);
    const decisionRecord = buildDecisionRecord({
      request: parsed.data as EvaluateRequest,
      response: result,
      decisionId,
      evaluatedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      ...result,
      usage,
      decision_id: decisionId,
      decision_record: decisionRecord,
    });
  } catch (err) {
    console.error("[/v1/evaluate] error:", err);
    // Fail closed with a clear error — never fabricate a verdict. Surface the
    // decision_id + failure_mode for traceability (no verdict / record on error).
    return NextResponse.json(
      { ok: false, error: "internal_error", decision_id: decisionId, failure_mode: "internal_error" },
      { status: 500 }
    );
  }
}
