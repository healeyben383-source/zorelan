export class ZorelanError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = "ZorelanError";
        this.status = status;
        this.data = data;
    }
}
export class Zorelan {
    constructor(apiKey, options = {}) {
        if (!apiKey || typeof apiKey !== "string") {
            throw new Error("Zorelan API key is required.");
        }
        this.apiKey = apiKey;
        this.baseUrl = (options.baseUrl ?? "https://zorelan.com").replace(/\/+$/, "");
        this.fetchImpl = options.fetch ?? globalThis.fetch;
        if (!this.fetchImpl) {
            throw new Error("No fetch implementation available. Provide options.fetch in this environment.");
        }
    }
    async verify(prompt, options = {}) {
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
        let data;
        try {
            data = await response.json();
        }
        catch {
            throw new ZorelanError(`Zorelan returned a non-JSON response (${response.status}).`, response.status);
        }
        if (!response.ok) {
            const err = data;
            throw new ZorelanError(err?.error
                ? `Zorelan API error: ${err.error}`
                : `Zorelan request failed with status ${response.status}.`, response.status, err);
        }
        const success = data;
        if (!success.ok) {
            throw new ZorelanError("Zorelan returned an unexpected error payload.", response.status, success);
        }
        return success;
    }
    /**
     * Evaluate a structured proposed action against a policy before it executes.
     * Calls POST /v1/evaluate and returns a decision-first result
     * (ALLOW / REVIEW / BLOCK). Does not affect verify(prompt).
     */
    async evaluateAction(payload) {
        if (!payload || typeof payload !== "object") {
            throw new Error("evaluateAction(payload) requires a request object.");
        }
        if (!payload.proposed_action ||
            typeof payload.proposed_action.type !== "string" ||
            !payload.proposed_action.type) {
            throw new Error("evaluateAction requires proposed_action with a non-empty type.");
        }
        if (!payload.policy ||
            !Array.isArray(payload.policy.rules) ||
            payload.policy.rules.length === 0) {
            throw new Error("evaluateAction requires policy.rules with at least one rule.");
        }
        const response = await this.fetchImpl(`${this.baseUrl}/v1/evaluate`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        let data;
        try {
            data = await response.json();
        }
        catch {
            throw new ZorelanError(`Zorelan returned a non-JSON response (${response.status}).`, response.status);
        }
        if (!response.ok) {
            const err = data;
            throw new ZorelanError(err?.error
                ? `Zorelan API error: ${err.error}`
                : `Zorelan request failed with status ${response.status}.`, response.status, err);
        }
        const success = data;
        if (!success.ok) {
            throw new ZorelanError("Zorelan returned an unexpected error payload.", response.status, success);
        }
        return success;
    }
}
