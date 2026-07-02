/**
 * lib/evaluate/schema.ts
 *
 * Shared zod validation for the structured evaluate contract. Used by both the
 * public /v1/evaluate endpoint and the internal /api/demo/evaluate route so the
 * accepted payload is identical.
 */

import { z } from "zod";

const MAX_TEXT = 10_000;

// `.strict()` so unknown top-level keys on proposed_action are REJECTED with a
// clear validation error instead of being silently stripped. Action details must
// go under `parameters` / `context` — e.g. `{ type, parameters: { amount, ... } }`,
// not flat `{ type, amount, ... }`. This makes the canonical shape hard to misuse
// (a flat payload previously produced an empty `normalized_proposed_action`).
export const ProposedActionSchema = z
  .object({
    type: z.string().min(1).max(200),
    parameters: z.record(z.string(), z.unknown()).optional(),
    reversible: z.boolean().optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const PolicySchema = z.object({
  name: z.string().min(1).max(500),
  rules: z.array(z.string().max(2_000)).min(1).max(50),
});

export const EvaluateRequestSchema = z.object({
  user_request: z.string().max(MAX_TEXT).optional(),
  model_output: z.string().max(MAX_TEXT).optional(),
  proposed_action: ProposedActionSchema,
  policy: PolicySchema,
  options: z
    .object({
      risk_tolerance: z.enum(["strict", "default", "lenient"]).optional(),
      require_live_data: z.boolean().optional(),
      max_latency_ms: z.number().int().positive().max(60_000).optional(),
    })
    .optional(),
});

export type EvaluateRequestInput = z.infer<typeof EvaluateRequestSchema>;
