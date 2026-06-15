"use client";

import { useState } from "react";
import { SCENARIOS, type DemoScenario } from "@/lib/demo/scenarios";
import type {
  EvaluateResponse,
  Verdict,
  PolicyMatchStatus,
  RiskSeverity,
} from "@/lib/evaluate/types";

// ── Display helpers ─────────────────────────────────────────────────────────────

const VERDICT_COLORS: Record<Verdict, string> = {
  ALLOW: "#16a34a",
  REVIEW: "#d97706",
  BLOCK: "#dc2626",
};

const VERDICT_SUBTITLE: Record<Verdict, string> = {
  ALLOW: "Safe to execute",
  REVIEW: "Human review required before executing",
  BLOCK: "Do not execute",
};

const STATUS_COLORS: Record<PolicyMatchStatus, string> = {
  satisfied: "#16a34a",
  violated: "#dc2626",
  not_applicable: "#6b7280",
  indeterminate: "#d97706",
};

const SEVERITY_COLORS: Record<RiskSeverity, string> = {
  low: "#6b7280",
  moderate: "#d97706",
  high: "#dc2626",
};

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

// ── Component ───────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0].id);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scenario: DemoScenario =
    SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const action = scenario.request.proposed_action;
  const policy = scenario.request.policy;

  function selectScenario(id: string) {
    setScenarioId(id);
    setResult(null);
    setError(null);
  }

  async function runEvaluation() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/demo/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenario.request),
      });

      if (!res.ok) {
        // Explicit, honest failure — never render a fabricated verdict.
        setError("Evaluation unavailable — cannot reach Zorelan.");
        return;
      }

      const data = (await res.json()) as EvaluateResponse | { ok: false };
      if (!data || (data as { ok?: boolean }).ok !== true) {
        setError("Evaluation unavailable — cannot reach Zorelan.");
        return;
      }

      setResult(data as EvaluateResponse);
    } catch {
      setError("Evaluation unavailable — cannot reach Zorelan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        padding: 32,
        fontFamily: "system-ui, Arial, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
        color: "#111",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>
          AI proposed an action. Should it run?
        </h1>
        <p style={{ color: "#555", marginTop: 8, fontSize: 15, lineHeight: 1.6 }}>
          Zorelan sits between an AI model and your backend. It evaluates a
          structured proposed action against your policy and returns{" "}
          <strong>ALLOW</strong>, <strong>REVIEW</strong>, or{" "}
          <strong>BLOCK</strong> — before anything executes.
        </p>
      </div>

      {/* Scenario selector */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          Scenario
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SCENARIOS.map((s) => {
            const active = s.id === scenarioId;
            return (
              <button
                key={s.id}
                onClick={() => selectScenario(s.id)}
                style={{
                  padding: "6px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: active ? "#1d4ed8" : "#f3f4f6",
                  color: active ? "#fff" : "#374151",
                  border: `1px solid ${active ? "#1d4ed8" : "#d1d5db"}`,
                  borderRadius: 20,
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Customer request + AI output */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <Panel label="Customer request">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            {scenario.request.user_request}
          </div>
        </Panel>
        <Panel label="AI model output (unverified)">
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            {scenario.request.model_output}
          </div>
        </Panel>
      </div>

      {/* Proposed action + Policy */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Panel label="Proposed action (structured)">
          <pre
            style={{
              margin: 0,
              fontSize: 12.5,
              fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#111",
            }}
          >
            {prettyJson(action)}
          </pre>
        </Panel>
        <Panel label={`Policy in effect — ${policy.name}`}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {policy.rules.map((rule, i) => (
              <li
                key={i}
                style={{ fontSize: 13.5, lineHeight: 1.6, marginBottom: 4 }}
              >
                {rule}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* Run button */}
      <button
        onClick={runEvaluation}
        disabled={loading}
        style={{
          padding: "10px 20px",
          fontSize: 15,
          fontWeight: 600,
          background: loading ? "#9ca3af" : "#1d4ed8",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: loading ? "not-allowed" : "pointer",
          marginBottom: 24,
        }}
      >
        {loading ? "Evaluating…" : "Run evaluation"}
      </button>

      {/* Explicit error state */}
      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: 14,
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            color: "#991b1b",
            fontSize: 14,
          }}
        >
          <strong>{error}</strong>
          <div style={{ fontSize: 12.5, marginTop: 4, color: "#b45309" }}>
            No decision is shown when evaluation fails — Zorelan never guesses a
            verdict.
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* WITHOUT ZORELAN */}
          <div
            style={{
              border: "2px solid #dc2626",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div style={{ background: "#dc2626", color: "#fff", padding: "10px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Without Zorelan</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                No gate — the action runs as proposed
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <div
                style={{
                  padding: "14px 16px",
                  background: "#111827",
                  color: "#fff",
                  borderRadius: 6,
                  fontWeight: 700,
                  fontSize: 15,
                  textAlign: "center",
                  marginBottom: 12,
                }}
              >
                Action executed
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#374151" }}>
                {scenario.blindOutcome}
              </div>
              {result.verdict !== "ALLOW" && (
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid #fecaca",
                    fontSize: 12.5,
                    color: "#991b1b",
                  }}
                >
                  Zorelan would have flagged this as{" "}
                  <strong>{result.verdict}</strong> — but with no gate, it ran
                  anyway.
                </div>
              )}
            </div>
          </div>

          {/* WITH ZORELAN */}
          <div
            style={{
              border: "2px solid #1d4ed8",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div style={{ background: "#1d4ed8", color: "#fff", padding: "10px 16px" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>With Zorelan</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
                Execution decision layer
              </div>
            </div>
            <div style={{ padding: 18 }}>
              {/* Single decision banner */}
              <div
                style={{
                  textAlign: "center",
                  padding: "24px 16px 18px",
                  background: VERDICT_COLORS[result.verdict],
                  borderRadius: 8,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 38,
                    fontWeight: 900,
                    color: "#fff",
                    letterSpacing: "0.06em",
                    lineHeight: 1,
                  }}
                >
                  {result.verdict}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.85)",
                    marginTop: 8,
                    fontWeight: 500,
                  }}
                >
                  {VERDICT_SUBTITLE[result.verdict]}
                </div>
              </div>

              {/* Reason */}
              <Block label="Reason">
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                  {result.reason}
                </div>
              </Block>

              {/* Policy matches */}
              {result.policy_matches.length > 0 && (
                <Block label="Policy matches">
                  {result.policy_matches.map((m, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            color: STATUS_COLORS[m.status],
                            flexShrink: 0,
                          }}
                        >
                          {m.status}
                        </span>
                        <span style={{ fontSize: 13, lineHeight: 1.5 }}>{m.rule}</span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "#6b7280",
                          marginTop: 2,
                          marginLeft: 0,
                          lineHeight: 1.5,
                        }}
                      >
                        {m.explanation}
                      </div>
                    </div>
                  ))}
                </Block>
              )}

              {/* Risk factors */}
              {result.risk_factors.length > 0 && (
                <Block label="Risk factors">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {result.risk_factors.map((r, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 12,
                          padding: "3px 10px",
                          borderRadius: 14,
                          border: `1px solid ${SEVERITY_COLORS[r.severity]}`,
                          color: SEVERITY_COLORS[r.severity],
                          fontWeight: 600,
                        }}
                      >
                        {r.factor}
                        {r.detail ? ` · ${r.detail}` : ""} ({r.severity})
                      </span>
                    ))}
                  </div>
                </Block>
              )}

              {/* Missing context */}
              {result.missing_context.length > 0 && (
                <Block label="Missing context">
                  {result.missing_context.map((m, i) => (
                    <div key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
                      <code
                        style={{
                          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
                          background: "#f3f4f6",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 12,
                        }}
                      >
                        {m.field}
                      </code>{" "}
                      — {m.why}
                    </div>
                  ))}
                </Block>
              )}

              {/* Next step */}
              <div
                style={{
                  marginTop: 4,
                  padding: "12px 14px",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#6b7280",
                    marginBottom: 4,
                  }}
                >
                  Next step · {result.next_step.action}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                  {result.next_step.recommendation}
                </div>
              </div>

              {/* How this was determined */}
              <details style={{ marginTop: 14 }}>
                <summary
                  style={{
                    fontSize: 12.5,
                    color: "#6b7280",
                    cursor: "pointer",
                  }}
                >
                  How this was determined
                </summary>
                <div style={{ marginTop: 10, fontSize: 12.5, color: "#374151" }}>
                  <div style={{ marginBottom: 6 }}>
                    Decision basis:{" "}
                    <strong style={{ textTransform: "capitalize" }}>
                      {result.decision_basis}
                    </strong>{" "}
                    · Confidence: {result.confidence.score}/100 (
                    {result.confidence.label}) · Providers used:{" "}
                    {result.providers_used.length > 0
                      ? result.providers_used.join(", ")
                      : "none"}{" "}
                    · Fallback: {result.fell_back ? "yes" : "no"}
                  </div>
                  {result.evidence.map((e, i) => (
                    <div
                      key={i}
                      style={{ marginBottom: 4, lineHeight: 1.5, color: "#4b5563" }}
                    >
                      <span style={{ color: "#6b7280" }}>[{e.source}]</span>{" "}
                      {e.note}
                    </div>
                  ))}
                  <div style={{ marginTop: 8, color: "#9ca3af", fontSize: 11.5 }}>
                    Pass 1: decisions are deterministic policy checks on the
                    structured action. Single-model judgement is a planned later
                    stage and will never override a deterministic block.
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ── Small presentational helpers ────────────────────────────────────────────────

function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#6b7280",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
