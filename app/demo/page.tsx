"use client";

import { useState } from "react";

type Risk = "low" | "moderate" | "high";
type Decision = "SEND" | "REVIEW" | "BLOCK";

interface ModelDiagnostic {
  provider?: string;
  quality_score?: number;
  duration_ms?: number;
  timed_out?: boolean;
  used_fallback?: boolean;
}

interface VerifyResult {
  trust: number;
  risk: Risk;
  decision: Decision;
  verified_answer: string | null;
  shared_conclusion: string | null;
  key_disagreement: string | null;
  decision_rule: string | null;
  decision_reason: string | null;
  consensus: "high" | "medium" | "low" | null;
  semantic_label: string | null;
  disagreement_type: string | null;
  final_conclusion_aligned: boolean | null;
  model_diagnostics: ModelDiagnostic[] | null;
}

const DECISION_COLORS: Record<Decision, string> = {
  SEND: "#16a34a",
  REVIEW: "#d97706",
  BLOCK: "#dc2626"
};

const RISK_COLORS: Record<Risk, string> = {
  low: "#16a34a",
  moderate: "#d97706",
  high: "#dc2626"
};

function decisionLabel(decision: Decision): string {
  if (decision === "SEND") return "SAFE TO SEND";
  if (decision === "REVIEW") return "Requires review before sending";
  return "DO NOT PROCEED — BLOCK";
}

function insightLine(): string {
  return "Zorelan doesn't just verify answers — it verifies whether it's safe to act on them.";
}

function decisionExplanation(result: VerifyResult): string | null {
  if (result.decision === "SEND") {
    if (result.decision_rule) return result.decision_rule;
    if (result.shared_conclusion) return result.shared_conclusion;
    if (result.decision_reason) return result.decision_reason;
    return "Low-risk informational request with clear model agreement.";
  }
  // REVIEW or BLOCK
  if (result.decision_reason) return result.decision_reason;
  if (result.key_disagreement) return result.key_disagreement;
  if (result.decision_rule) return result.decision_rule;
  if (result.disagreement_type) return result.disagreement_type;
  if (result.risk === "high") return "High-risk signals detected — action was stopped before execution.";
  if (result.risk === "moderate") return "Moderate risk detected — human review required before proceeding.";
  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function clampSentences(text: string, max = 2): string {
  const cleaned = stripMarkdown(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences.slice(0, max).join(" ").trim() || cleaned.slice(0, 220).trim();
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRun = async () => {
    if (!message.trim()) return;

    setLoading(true);
    setError("");
    setDraft("");
    setVerifyResult(null);

    try {
      // Step 1: Generate draft
      const genRes = await fetch("/api/demo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });

      const genData = await genRes.json();

      if (!genRes.ok) throw new Error(genData.error || "Failed to generate response");

      const generatedDraft: string = genData.draft;
      setDraft(generatedDraft);

      // Step 2: Verify the SAME draft
      const verifyRes = await fetch("/api/demo/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: generatedDraft, raw_prompt: message })
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) throw new Error(verifyData.error || "Failed to verify response");

      setVerifyResult(verifyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: 32, fontFamily: "system-ui, Arial, sans-serif", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>AI can be right — and still unsafe to act on.</h1>
        <p style={{ color: "#555", marginTop: 8, fontSize: 15 }}>
          See what happens when AI responses are sent without verification — and what Zorelan catches.
        </p>
      </div>

      {/* Input */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          Customer message
        </label>

        {/* Preset scenario buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {[
            { label: "Safe response (SEND)", message: "Where can I find my order tracking number?" },
            { label: "Needs review (REVIEW)", message: "A customer wants to return an item after 45 days. Our policy says 30 days." },
            { label: "High risk (BLOCK)", message: "Customer says they never received their order and wants a full refund.\nWe have not confirmed delivery status yet.\nWrite a response." }
          ].map(({ label, message: preset }) => (
            <button
              key={label}
              onClick={() => setMessage(preset)}
              style={{
                padding: "4px 12px",
                fontSize: 13,
                fontWeight: 500,
                background: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: 20,
                cursor: "pointer"
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#e5e7eb")}
              onMouseLeave={e => (e.currentTarget.style.background = "#f3f4f6")}
            >
              {label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. I was charged twice for my order and I want a refund immediately."
          rows={4}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 15,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            boxSizing: "border-box",
            resize: "vertical"
          }}
        />
        <button
          onClick={handleRun}
          disabled={loading || !message.trim()}
          style={{
            marginTop: 10,
            padding: "10px 20px",
            fontSize: 15,
            fontWeight: 600,
            background: loading ? "#9ca3af" : "#1d4ed8",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: loading || !message.trim() ? "not-allowed" : "pointer"
          }}
        >
          {loading ? "Processing..." : "Generate → Verify → Decide"}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, color: "#991b1b" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* AI Draft (shared) */}
      {draft && (
        <div style={{ marginBottom: 28, padding: 16, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              AI Generated Response (Unverified)
            </div>
            <div style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 4, padding: "2px 8px" }}>
              ⚠️ Not yet validated
            </div>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: "#111" }}>
            {draft}
          </div>
        </div>
      )}

      {/* Side-by-side comparison */}
      {draft && verifyResult && (
        <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

          {/* WITHOUT VERIFICATION */}
          <div style={{ border: "2px solid #dc2626", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: "#dc2626", color: "#fff", padding: "10px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Without Verification</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>No decision layer applied</div>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Message:</div>
                <div style={{ fontSize: 13, color: "#9ca3af", lineHeight: 1.6 }}>{draft}</div>
              </div>
              <div style={{
                padding: "16px",
                background: "#16a34a",
                color: "#fff",
                borderRadius: 6,
                fontWeight: 800,
                fontSize: 22,
                textAlign: "center",
                letterSpacing: "0.08em"
              }}>
                Sent
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #fecaca" }}>
                <div style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.5 }}>
                  Response matches the request. No validation performed.
                </div>
              </div>
            </div>
          </div>

          {/* WITH ZORELAN VERIFICATION */}
          <div style={{ border: "2px solid #1d4ed8", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ background: "#1d4ed8", color: "#fff", padding: "10px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>With Zorelan Verification</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>Verification + decision layer</div>
            </div>
            <div style={{ padding: 20 }}>

              {/* SYSTEM DECISION — primary output */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>System decision</div>
                <div style={{
                  padding: "16px",
                  background: DECISION_COLORS[verifyResult.decision],
                  color: "#fff",
                  borderRadius: 6,
                  fontWeight: 800,
                  fontSize: 22,
                  textAlign: "center",
                  letterSpacing: "0.08em"
                }}>
                  {verifyResult.decision === "SEND" && "ALLOW"}
                  {verifyResult.decision === "REVIEW" && "REVIEW REQUIRED"}
                  {verifyResult.decision === "BLOCK" && "BLOCKED"}
                </div>
                {verifyResult.decision_reason && (
                  <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>
                    {verifyResult.decision_reason}
                  </p>
                )}
              </div>

              {/* Why Zorelan allowed/stopped this */}
              {decisionExplanation(verifyResult) && (
                <div style={{ marginBottom: 20, padding: "10px 12px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    {verifyResult.decision === "SEND" ? "Why this is safe to send" : "Why this was stopped"}
                  </div>
                  <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>
                    {decisionExplanation(verifyResult)}
                  </div>
                </div>
              )}

              {/* Trust score */}
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#e5e7eb" }}>{verifyResult.trust >= 75 ? "High" : verifyResult.trust >= 55 ? "Moderate" : "Low"} confidence ({verifyResult.trust} / 100)</span>
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>Based on cross-model verification</div>

              {/* Trust bar */}
              <div style={{ height: 8, background: "#e5e7eb", borderRadius: 4, marginBottom: 20 }}>
                <div style={{
                  height: "100%",
                  width: `${verifyResult.trust}%`,
                  background: verifyResult.trust >= 75 ? "#16a34a" : verifyResult.trust >= 55 ? "#d97706" : "#dc2626",
                  borderRadius: 4,
                  transition: "width 0.4s ease"
                }} />
              </div>

              {/* Reasoning fields */}
              <div style={{ marginBottom: 20, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
                {verifyResult.verified_answer && (
                  <div style={{ padding: "12px 14px", borderBottom: "1px solid #e2e8f0", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px 6px 0 0" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Verified answer (synthesized)</div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#e5e7eb", lineHeight: 1.7 }}>{clampSentences(verifyResult.verified_answer)}</div>
                  </div>
                )}
                {verifyResult.shared_conclusion && (
                  <div style={{ padding: "12px", marginTop: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Shared conclusion</div>
                    <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>{verifyResult.shared_conclusion}</div>
                  </div>
                )}
                {verifyResult.key_disagreement && (
                  <div style={{ padding: "12px", marginTop: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Key difference</div>
                    <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>{verifyResult.key_disagreement}</div>
                  </div>
                )}
                {verifyResult.decision_rule && (
                  <div style={{ padding: "12px", marginTop: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Decision rule</div>
                    <div style={{ fontSize: 13, color: "#d1d5db", lineHeight: 1.6 }}>{verifyResult.decision_rule}</div>
                  </div>
                )}
              </div>

              {/* Risk + consensus row */}
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#e5e7eb" }}>
                  Action risk:{" "}
                  <span style={{ color: RISK_COLORS[verifyResult.risk], textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {verifyResult.risk}
                  </span>
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#9ca3af", marginBottom: 8 }}>This response may be correct — but acting on it has real-world consequences.</div>
              <div style={{ fontSize: 12, color: "#9ca3af", fontStyle: "italic", marginBottom: 16 }}>Zorelan separates correctness from action safety</div>

              {/* Decision — dominant element */}
              <div style={{
                padding: "16px",
                background: DECISION_COLORS[verifyResult.decision],
                color: "#fff",
                borderRadius: 6,
                fontWeight: 800,
                fontSize: 22,
                textAlign: "center",
                letterSpacing: "0.08em"
              }}>
                {decisionLabel(verifyResult.decision)}
              </div>

              {/* Decision logic explanation */}
              {verifyResult.decision === "REVIEW" ? (
                <div style={{ marginTop: 10, padding: "8px 12px", background: "#1c1917", borderLeft: "4px solid #d97706", borderRadius: 4, lineHeight: 1.6 }}>
                  <span style={{ fontSize: 13, color: "#f5f5f4", fontWeight: 500 }}>⚠️ Would have been sent to the customer — no checks, no review.</span>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: "#6b7280", marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>
                  {verifyResult.decision === "SEND" && "Zorelan verified this response is correct and safe to act on."}
                  {verifyResult.decision === "BLOCK" && "Zorelan verified that the correct action is to not proceed and secure the account."}
                </p>
              )}
            </div>
          </div>

        </div>

        {/* Insight line */}
        <div style={{ marginTop: 16, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 14, color: "#1e40af", lineHeight: 1.6 }}>
          {insightLine()}
        </div>
        </div>
      )}
    </main>
  );
}
