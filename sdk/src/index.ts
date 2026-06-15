export type AgreementLevel = "high" | "medium" | "low";
export type RiskLevel = "low" | "moderate" | "high";
export type TrustLabel = "high" | "moderate" | "low";
export type DisagreementType =
  | "none"
  | "additive_nuance"
  | "explanation_variation"
  | "conditional_alignment"
  | "material_conflict";

export type ZorelanUsage = {
  plan: string;
  callsLimit: number;
  callsUsed: number;
  callsRemaining: number;
  status: "active" | "inactive";
} | null;

export type ZorelanDecisionSuccess = {
  ok: true;
  verdict: string;
  consensus: {
    level: AgreementLevel;
    models_aligned: number;
  };
  risk_level: RiskLevel;
  key_disagreement: string;
  recommended_action: string;
  analysis: string;
  verified_answer: string;
  confidence: AgreementLevel;
  confidence_reason: string;
  trust_score: {
    score: number;
    label: TrustLabel;
    reason: string;
  };
  providers_used: string[];
  verification: {
    final_conclusion_aligned: boolean;
    disagreement_type: DisagreementType;
    semantic_label: string;
    semantic_rationale: string;
    semantic_judge_model: string;
    semantic_used_fallback: boolean;
  };
  arbitration: {
    used: boolean;
    provider: string | null;
    winning_pair: string[];
    pair_strengths: {
      initial: number;
      withAThird: number | null;
      withBThird: number | null;
    } | null;
  };
  model_diagnostics: Record<
    string,
    {
      quality_score: number | null;
      duration_ms: number;
      timed_out: boolean;
      used_fallback: boolean;
    }
  >;
  meta: {
    task_type: string;
    overlap_ratio: number;
    agreement_summary: string;
    prompt_chars: number;
    likely_conflict: boolean;
    disagreement_type: DisagreementType;
    initial_pair: string[];
  };
  usage: ZorelanUsage;
  cached?: boolean;
};

export type ZorelanDecisionError = {
  ok: false;
  error: string;
  retry_after?: number;
  scope?: "ip" | "api_key";
  plan?: string;
  calls_limit?: number;
  calls_used?: number;
  calls_remaining?: number;
  status?: "active" | "inactive";
};

export type ZorelanDecisionResponse =
  | ZorelanDecisionSuccess
  | ZorelanDecisionError;

export type VerifyOptions = {
  cacheBypass?: boolean;
};

// ── Structured execution-gate evaluation (POST /v1/evaluate) ────────────────────
// Additive contract for evaluateAction(). Mirrors the server shape in
// lib/evaluate/types.ts. Independent of the legacy verify(prompt) types above.

export type EvaluationVerdict = "ALLOW" | "REVIEW" | "BLOCK";
export type RiskSeverity = "low" | "moderate" | "high";
export type DecisionBasis = "deterministic" | "model" | "arbitrated";
export type NextStepAction = "execute" | "open_review" | "block";
export type PolicyMatchStatus =
  | "satisfied"
  | "violated"
  | "not_applicable"
  | "indeterminate";

export type ProposedAction = {
  /** e.g. "refund_customer" | "delete_account" | "downgrade_subscription" | "update_crm_record" */
  type: string;
  parameters?: Record<string, unknown>;
  reversible?: boolean;
  context?: Record<string, unknown>;
};

export type ActionPolicy = {
  name: string;
  rules: string[];
};

export type EvaluateActionOptions = {
  risk_tolerance?: "strict" | "default" | "lenient";
  require_live_data?: boolean;
  max_latency_ms?: number;
};

export type EvaluateActionRequest = {
  user_request?: string;
  model_output?: string;
  proposed_action: ProposedAction;
  policy: ActionPolicy;
  options?: EvaluateActionOptions;
};

export type PolicyMatch = {
  rule: string;
  status: PolicyMatchStatus;
  explanation: string;
};

export type RiskFactor = {
  factor: string;
  severity: RiskSeverity;
  detail?: string;
};

export type MissingContext = {
  field: string;
  why: string;
};

export type EvidenceItem = {
  source: string; // "deterministic" | "model:<provider>"
  note: string;
};

export type NextStep = {
  action: NextStepAction;
  recommendation: string;
};

export type UsageMeta = {
  plan: string;
  callsLimit: number;
  callsUsed: number;
  callsRemaining: number;
  status: "active" | "inactive";
};

export type EvaluateActionResponse = {
  ok: true;
  verdict: EvaluationVerdict;
  reason: string;
  policy_matches: PolicyMatch[];
  risk_factors: RiskFactor[];
  missing_context: MissingContext[];
  evidence: EvidenceItem[];
  next_step: NextStep;
  decision_basis: DecisionBasis;
  confidence: { score: number; label: "low" | "moderate" | "high" };
  providers_used: string[];
  fell_back: boolean;
  cached: boolean;
  usage?: UsageMeta | null;
};

export type ZorelanClientOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export class ZorelanError extends Error {
  readonly status: number;
  readonly data?: ZorelanDecisionError | unknown;

  constructor(message: string, status: number, data?: ZorelanDecisionError | unknown) {
    super(message);
    this.name = "ZorelanError";
    this.status = status;
    this.data = data;
  }
}

export class Zorelan {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(apiKey: string, options: ZorelanClientOptions = {}) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("Zorelan API key is required.");
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? "https://zorelan.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;

    if (!this.fetchImpl) {
      throw new Error(
        "No fetch implementation available. Provide options.fetch in this environment."
      );
    }
  }

  async verify(
    prompt: string,
    options: VerifyOptions = {}
  ): Promise<ZorelanDecisionSuccess> {
    if (!prompt || typeof prompt !== "string") {
      throw new Error("verify(prompt) requires a non-empty string prompt.");
    }

    const response = await this.fetchImpl(`${this.baseUrl}/v1/decision`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        ...(options.cacheBypass ? { cache_bypass: true } : {}),
      }),
    });

    let data: ZorelanDecisionResponse | unknown;

    try {
      data = await response.json();
    } catch {
      throw new ZorelanError(
        `Zorelan returned a non-JSON response (${response.status}).`,
        response.status
      );
    }

    if (!response.ok) {
      const err = data as ZorelanDecisionError;
      throw new ZorelanError(
        err?.error
          ? `Zorelan API error: ${err.error}`
          : `Zorelan request failed with status ${response.status}.`,
        response.status,
        err
      );
    }

    const success = data as ZorelanDecisionSuccess;

    if (!success.ok) {
      throw new ZorelanError(
        "Zorelan returned an unexpected error payload.",
        response.status,
        success
      );
    }

    return success;
  }

  /**
   * Evaluate a structured proposed action against a policy before it executes.
   * Calls POST /v1/evaluate and returns a decision-first result
   * (ALLOW / REVIEW / BLOCK). Does not affect verify(prompt).
   */
  async evaluateAction(
    payload: EvaluateActionRequest
  ): Promise<EvaluateActionResponse> {
    if (!payload || typeof payload !== "object") {
      throw new Error("evaluateAction(payload) requires a request object.");
    }
    if (
      !payload.proposed_action ||
      typeof payload.proposed_action.type !== "string" ||
      !payload.proposed_action.type
    ) {
      throw new Error(
        "evaluateAction requires proposed_action with a non-empty type."
      );
    }
    if (
      !payload.policy ||
      !Array.isArray(payload.policy.rules) ||
      payload.policy.rules.length === 0
    ) {
      throw new Error(
        "evaluateAction requires policy.rules with at least one rule."
      );
    }

    const response = await this.fetchImpl(`${this.baseUrl}/v1/evaluate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let data: EvaluateActionResponse | ZorelanDecisionError | unknown;

    try {
      data = await response.json();
    } catch {
      throw new ZorelanError(
        `Zorelan returned a non-JSON response (${response.status}).`,
        response.status
      );
    }

    if (!response.ok) {
      const err = data as ZorelanDecisionError;
      throw new ZorelanError(
        err?.error
          ? `Zorelan API error: ${err.error}`
          : `Zorelan request failed with status ${response.status}.`,
        response.status,
        err
      );
    }

    const success = data as EvaluateActionResponse;

    if (!success.ok) {
      throw new ZorelanError(
        "Zorelan returned an unexpected error payload.",
        response.status,
        success
      );
    }

    return success;
  }
}