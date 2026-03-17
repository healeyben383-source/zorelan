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
}
