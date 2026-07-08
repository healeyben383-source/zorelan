export type AgreementLevel = "high" | "medium" | "low";
export type RiskLevel = "low" | "moderate" | "high";
export type TrustLabel = "high" | "moderate" | "low";
export type DisagreementType = "none" | "additive_nuance" | "explanation_variation" | "conditional_alignment" | "material_conflict";
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
    model_diagnostics: Record<string, {
        quality_score: number | null;
        duration_ms: number;
        timed_out: boolean;
        used_fallback: boolean;
    }>;
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
export type ZorelanDecisionResponse = ZorelanDecisionSuccess | ZorelanDecisionError;
export type VerifyOptions = {
    cacheBypass?: boolean;
};
export type EvaluationVerdict = "ALLOW" | "REVIEW" | "BLOCK";
export type RiskSeverity = "low" | "moderate" | "high";
export type DecisionBasis = "deterministic" | "model" | "arbitrated";
export type NextStepAction = "execute" | "open_review" | "block";
export type PolicyMatchStatus = "satisfied" | "violated" | "not_applicable" | "indeterminate";
export type ProposedAction = {
    /** e.g. "refund_customer" | "delete_account" | "downgrade_subscription" | "update_crm_record" */
    type: string;
    parameters?: Record<string, unknown>;
    reversible?: boolean;
    context?: Record<string, unknown>;
};
/**
 * Typed, enforceable refund controls. These drive the numeric refund verdict —
 * the free-text `rules` never do. Optional/backward-compatible; when absent, a
 * refund fails safe to REVIEW rather than having an undocumented threshold applied.
 */
export type RefundControls = {
    currency: string;
    /** Refunds with amount <= auto_allow_limit auto-ALLOW. */
    auto_allow_limit: number;
    /** Ceiling: amount >= absolute_review_limit always REVIEWs (at-or-above). */
    absolute_review_limit: number;
    /** Require delivery_confirmed only for refunds above auto_allow_limit. */
    require_delivery_confirmation_above_auto_allow_limit: boolean;
};
export type PolicyControls = {
    refund?: RefundControls;
};
export type ActionPolicy = {
    name: string;
    rules: string[];
    controls?: PolicyControls;
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
    source: string;
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
/**
 * Decision Record V1 (schema `dr-v1`) — a structured, identified projection of a
 * single decision, returned by /v1/evaluate for inspection/audit/replay.
 * Additive: the flat fields on EvaluateActionResponse remain the source of truth.
 */
export type DecisionRecord = {
    schema_version: "dr-v1";
    decision_id: string;
    evaluated_at: string;
    latency_ms: number;
    final_verdict: EvaluationVerdict;
    action_type: string;
    normalized_proposed_action: ProposedAction;
    policy_snapshot: ActionPolicy;
    reason: string;
    policy_matches: PolicyMatch[];
    matched_rules: string[];
    violated_rules: string[];
    missing_context: MissingContext[];
    risk_factors: RiskFactor[];
    decision_basis: DecisionBasis;
    confidence: {
        score: number;
        label: "low" | "moderate" | "high";
    };
    next_step: NextStep;
    recommended_next_step: string;
    /** The typed controls actually enforced for this verdict, or null. */
    policy_controls_applied: PolicyControls | null;
    failure_mode: string | null;
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
    confidence: {
        score: number;
        label: "low" | "moderate" | "high";
    };
    providers_used: string[];
    fell_back: boolean;
    cached: boolean;
    usage?: UsageMeta | null;
    /** The typed policy controls the engine actually enforced, or null. */
    policy_controls_applied?: PolicyControls | null;
    /** Decision Record V1 (additive). Present on /v1/evaluate responses. */
    decision_id?: string;
    decision_record?: DecisionRecord;
};
export type ZorelanClientOptions = {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
};
export declare class ZorelanError extends Error {
    readonly status: number;
    readonly data?: ZorelanDecisionError | unknown;
    constructor(message: string, status: number, data?: ZorelanDecisionError | unknown);
}
export declare class Zorelan {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly fetchImpl;
    constructor(apiKey: string, options?: ZorelanClientOptions);
    verify(prompt: string, options?: VerifyOptions): Promise<ZorelanDecisionSuccess>;
    /**
     * Evaluate a structured proposed action against a policy before it executes.
     * Calls POST /v1/evaluate and returns a decision-first result
     * (ALLOW / REVIEW / BLOCK). Does not affect verify(prompt).
     */
    evaluateAction(payload: EvaluateActionRequest): Promise<EvaluateActionResponse>;
}
