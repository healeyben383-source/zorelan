/**
 * app/api/demo/evaluate/route.ts
 *
 * Pass 1 — demo/internal structured execution-gate route.
 *
 * Accepts a structured { proposed_action, policy, ... } payload and returns a
 * decision-first verdict (ALLOW / REVIEW / BLOCK) from the deterministic engine
 * in lib/demo/evaluateAction.ts. No external providers are called, so this route
 * works locally without secrets and never fabricates a verdict.
 *
 * This is intentionally separate from /api/decision and /v1/decision — the
 * legacy prompt-agreement engine is untouched.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateActionDeterministic,
  type EvaluateRequest,
} from "@/lib/demo/evaluateAction";

export const runtime = "nodejs";

const ProposedActionSchema = z.object({
  type: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  reversible: z.boolean().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const PolicySchema = z.object({
  name: z.string().min(1),
  rules: z.array(z.string()).min(1),
});

const EvaluateRequestSchema = z.object({
  user_request: z.string().max(10_000).optional(),
  model_output: z.string().max(10_000).optional(),
  proposed_action: ProposedActionSchema,
  policy: PolicySchema,
  options: z
    .object({
      risk_tolerance: z.enum(["strict", "default", "lenient"]).optional(),
      require_live_data: z.boolean().optional(),
      max_latency_ms: z.number().optional(),
    })
    .optional(),
});

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
    // Stage 0 (deterministic) only in this pass. Stage 1 model judgement is a
    // documented TODO in lib/demo/evaluateAction.ts and must not override the
    // deterministic floors when added.
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
