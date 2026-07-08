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

// Typed, enforceable refund controls. These drive the numeric refund verdict —
// the free-text `rules` never do. Negative limits and a conflicting ordering
// (auto_allow_limit above absolute_review_limit) are rejected here with a clear
// validation error, so an invalid control set can never quietly enforce.
export const RefundControlsSchema = z
  .object({
    currency: z.string().min(1).max(10),
    auto_allow_limit: z.number().nonnegative(),
    absolute_review_limit: z.number().nonnegative(),
    require_delivery_confirmation_above_auto_allow_limit: z.boolean(),
  })
  .strict()
  .refine((c) => c.auto_allow_limit <= c.absolute_review_limit, {
    message: "auto_allow_limit must be less than or equal to absolute_review_limit",
    path: ["auto_allow_limit"],
  });

export const PolicyControlsSchema = z
  .object({
    refund: RefundControlsSchema.optional(),
  })
  .strict();

export const PolicySchema = z.object({
  name: z.string().min(1).max(500),
  rules: z.array(z.string().max(2_000)).min(1).max(50),
  controls: PolicyControlsSchema.optional(),
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
