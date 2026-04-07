import type { Metadata } from "next";
import { Suspense } from "react";
import PricingButtons from "./PricingButtons";
import CheckoutStatusBanner from "./CheckoutStatusBanner";

export const metadata: Metadata = {
  title: "API Docs — Zorelan",
  description:
    "Verify AI before it reaches your users. Zorelan compares multiple model responses and returns a verified answer with trust scoring, risk signals, and disagreement analysis.",
};

const sdkInstallExample = `npm install @zorelan/sdk`;

const sdkQuickstartExample = `import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(
  "Should I use HTTPS for my web application?"
);

console.log(result.verified_answer);
console.log(result.trust_score.score);
console.log(result.risk_level);
console.log(result.recommended_action);`;

const curlExample = `curl -X POST https://zorelan.com/v1/decision \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Should I use HTTPS for my web application?"}'`;

const advancedCurlExample = `curl -X POST https://zorelan.com/v1/decision \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Determine whether HTTPS should be used for a production web application. Include security, SEO, and compliance considerations.",
    "raw_prompt": "Should I use HTTPS for my web application?",
    "cache_bypass": true
  }'`;

const nodeExample = `import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(
  "Should I use HTTPS for my web application?"
);

console.log(result.verified_answer);    // synthesized answer
console.log(result.trust_score.score);  // 0–100
console.log(result.consensus.level);    // "high" | "medium" | "low"
console.log(result.cached);             // true if result was cached`;

const pythonExample = `import requests
import os

response = requests.post(
    "https://zorelan.com/v1/decision",
    headers={
        "Authorization": f"Bearer {os.environ['ZORELAN_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "prompt": "Should I use HTTPS for my web application?",
    }
)

data = response.json()
print(data["verified_answer"])
print(data["trust_score"]["score"])
print(data["consensus"]["level"])
print(data["cached"])  # True if result was cached`;

const advancedJsonExample = `{
  "prompt": "Determine whether HTTPS should be used for a production web application. Include security, SEO, and compliance considerations.",
  "raw_prompt": "Should I use HTTPS for my web application?",
  "cache_bypass": true
}`;

const minimalResponseExample = `{
  "ok": true,
  "verified_answer": "Yes — you should use HTTPS for your web application.",
  "decision": "allow",
  "decision_reason": "Low risk, high trust score, and consistent model agreement. Output is safe to act on.",
  "trust_score": {
    "score": 94,
    "label": "high",
    "reason": "The providers strongly agree on a low-risk best-practice conclusion."
  },
  "risk_level": "low",
  "consensus": {
    "level": "high",
    "models_aligned": 2
  },
  "recommended_action": "Use the shared conclusion as the answer."
}`;

const responseExample = `{
  "ok": true,
  "decision": "allow",
  "decision_reason": "Low risk, high trust score, and consistent model agreement. Output is safe to act on.",
  "verified_answer": "Yes — you should use HTTPS for your web application. The providers agree that HTTPS is standard practice for protecting user data, securing sessions, and establishing trust.",
  "verdict": "Models are aligned on the main conclusion",
  "consensus": {
    "level": "high",
    "models_aligned": 2
  },
  "trust_score": {
    "score": 94,
    "label": "high",
    "reason": "The original answers support the same main conclusion, Models strongly agree on the core conclusion, provider output quality is strong, with no meaningful disagreement; overall risk is low."
  },
  "risk_level": "low",
  "confidence": "high",
  "confidence_reason": "Both models reached the same core conclusion with no meaningful disagreement.",
  "key_disagreement": "No meaningful disagreement",
  "recommended_action": "Use the shared conclusion as the answer.",
  "cached": false,
  "providers_used": ["anthropic", "perplexity"],
  "verification": {
    "final_conclusion_aligned": true,
    "disagreement_type": "none",
    "semantic_label": "HIGH_AGREEMENT",
    "semantic_rationale": "Both answers strongly recommend HTTPS as standard practice for security and trust.",
    "semantic_judge_model": "openai/gpt-4o-mini",
    "semantic_used_fallback": false
  },
  "arbitration": {
    "used": false,
    "provider": null,
    "winning_pair": ["anthropic", "perplexity"],
    "pair_strengths": null
  },
  "model_diagnostics": {
    "anthropic": { "quality_score": 9, "duration_ms": 4571, "timed_out": false, "used_fallback": false },
    "perplexity": { "quality_score": 8, "duration_ms": 5158, "timed_out": false, "used_fallback": false }
  },
  "meta": {
    "task_type": "general",
    "overlap_ratio": 0.42,
    "agreement_summary": "The two model outputs support the same main conclusion.",
    "prompt_chars": 42,
    "execution_prompt_chars": 118,
    "likely_conflict": false,
    "disagreement_type": "none",
    "initial_pair": ["anthropic", "perplexity"]
  },
  "usage": {
    "plan": "pro",
    "callsLimit": 1000,
    "callsUsed": 42,
    "callsRemaining": 958,
    "status": "active"
  }
}`;

const cacheBypassExample = `{
  "prompt": "Should I use HTTPS for my web application?",
  "cache_bypass": true
}`;

const integrationExample = `import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(userInput);

// Gate execution on result.decision — the authoritative field
if (result.decision === "allow") {
  showAnswer(result.verified_answer);
} else if (result.decision === "review") {
  showWithWarning(result.verified_answer, result.decision_reason);
} else {
  // "block" — high risk, material conflict, or unresolved conditions
  requireHumanReview(result.decision_reason);
}`;

const feedbackPostExample = `curl -X POST https://zorelan.com/api/feedback \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Should I use HTTPS for my web application?",
    "verdict": "Models are aligned on the main conclusion",
    "issue": "incorrect_verdict",
    "correct_answer": "HTTPS should be used by default for production web applications.",
    "request_id": "req_abc123",
    "notes": "This should be treated as a low-risk best-practice question."
  }'`;

const feedbackGetExample = `curl https://zorelan.com/api/feedback \\
  -H "Authorization: Bearer YOUR_MASTER_KEY"`;

const responseFields = [
  {
    field: "decision",
    type: "string",
    desc: '"allow" · "review" · "block" — the authoritative execution gate. Derived from risk level, disagreement type, model alignment, and trust score. Use this field to drive product logic; do not re-implement the gate from trust_score alone.',
  },
  {
    field: "decision_reason",
    type: "string",
    desc: "Plain English explanation of why this decision was reached.",
  },
  {
    field: "verified_answer",
    type: "string",
    desc: "The synthesized final answer combining the best insights from the active provider pair.",
  },
  {
    field: "verdict",
    type: "string",
    desc: "A concise decision verdict describing the overall result.",
  },
  {
    field: "consensus.level",
    type: "string",
    desc: '"high" · "medium" · "low" — how strongly the models agreed.',
  },
  {
    field: "consensus.models_aligned",
    type: "number",
    desc: "Number of models that reached the same conclusion.",
  },
  {
    field: "trust_score.score",
    type: "number",
    desc: "Overall reliability score from 0–100. Calibrated from consensus, disagreement severity, and risk.",
  },
  {
    field: "trust_score.label",
    type: "string",
    desc: '"high" (≥75) · "moderate" (≥55) · "low" (<55)',
  },
  {
    field: "trust_score.reason",
    type: "string",
    desc: "Plain English explanation of why the score is what it is.",
  },
  {
    field: "risk_level",
    type: "string",
    desc: '"low" · "moderate" · "high" — assessed risk of acting on this answer.',
  },
  {
    field: "key_disagreement",
    type: "string",
    desc: "The main tension, tradeoff, or difference between the model responses.",
  },
  {
    field: "recommended_action",
    type: "string",
    desc: "Practical guidance on how to use this answer.",
  },
  {
    field: "cached",
    type: "boolean",
    desc: 'false on a fresh live verification. true when the result was served from cache — meaning this calibrated prompt path was verified within the last 6 hours and the stored result is being returned. Use cache_bypass: true to force a fresh verification.',
  },
  {
    field: "providers_used",
    type: "string[]",
    desc: "The AI providers queried for this request.",
  },
  {
    field: "verification.disagreement_type",
    type: "string",
    desc: "Structured classification of how models differed. See disagreement types below.",
  },
  {
    field: "verification.semantic_judge_model",
    type: "string",
    desc: "Which model performed the neutral semantic judgment.",
  },
  {
    field: "arbitration.used",
    type: "boolean",
    desc: "Whether a third model was invoked to resolve disagreement.",
  },
  {
    field: "model_diagnostics",
    type: "object",
    desc: "Per-provider quality scores, latency, and timeout status.",
  },
  {
    field: "meta.task_type",
    type: "string",
    desc: '"technical" · "strategy" · "creative" · "general" — detected category of the calibrated prompt.',
  },
  {
    field: "meta.prompt_chars",
    type: "number",
    desc: "Character count of the calibrated prompt path. When raw_prompt is provided, this reflects raw_prompt.",
  },
  {
    field: "meta.execution_prompt_chars",
    type: "number",
    desc: "Character count of the execution prompt sent to providers. Present when execution and calibration prompts differ.",
  },
  {
    field: "usage",
    type: "object",
    desc: "Your current plan, call limits, and remaining calls for the billing period.",
  },
];

const errorCodes = [
  {
    status: "400",
    code: "missing_prompt",
    desc: 'The request body is missing the required "prompt" field.',
  },
  {
    status: "400",
    code: "invalid_raw_prompt",
    desc: 'The optional "raw_prompt" field was provided but is not a string.',
  },
  {
    status: "400",
    code: "prompt_too_large",
    desc: "The prompt exceeds 10,000 characters.",
  },
  {
    status: "401",
    code: "unauthorized",
    desc: "Missing or invalid API key.",
  },
  {
    status: "403",
    code: "subscription_inactive",
    desc: "Your subscription is inactive. Check your billing at zorelan.com.",
  },
  {
    status: "429",
    code: "rate_limit_exceeded",
    desc: "You have used all calls for this billing period.",
  },
  {
    status: "429",
    code: "too_many_requests",
    desc: 'Too many requests in a short window. Includes a "retry_after" field in seconds.',
  },
  {
    status: "500",
    code: "internal_error",
    desc: "An unexpected server error. Retry with exponential backoff.",
  },
];

const disagreementTypes = [
  {
    type: "none",
    impact: "No penalty",
    desc: "Models reached the same conclusion with no meaningful difference.",
  },
  {
    type: "additive_nuance",
    impact: "No penalty",
    desc: "One model added correct detail without changing the core conclusion.",
  },
  {
    type: "explanation_variation",
    impact: "−4 pts",
    desc: "Same conclusion, different framing, emphasis, or supporting reasoning.",
  },
  {
    type: "conditional_alignment",
    impact: "−12 pts",
    desc: "A usable answer exists only by adding context or conditions. Models did not cleanly agree.",
  },
  {
    type: "material_conflict",
    impact: "−20 pts",
    desc: "Models gave materially opposite recommendations or conclusions.",
  },
];

// Navigation anchor sections
const NAV_ITEMS = [
  { label: "Why Zorelan", href: "#why" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Trust scoring", href: "#trust" },
  { label: "API reference", href: "#api-reference" },
  { label: "Caching", href: "#caching" },
  { label: "Errors", href: "#errors" },
  { label: "Feedback", href: "#feedback" },
  { label: "Access", href: "#access" },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-widest text-white/40 mb-3">
      {children}
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-white/[0.03] border-b border-white/10">
        <span className="text-xs font-mono text-white/30 uppercase tracking-widest">
          {label}
        </span>
      </div>
      <pre className="text-sm font-mono text-white/75 whitespace-pre-wrap p-5 leading-relaxed overflow-x-auto">
        {code}
      </pre>
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-widest text-white/30"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/10 last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-5 py-4 text-white/50 align-top ${
                    j === 0
                      ? "font-mono text-white/70 text-xs whitespace-nowrap"
                      : ""
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-5 py-4 text-sm text-white/60 leading-relaxed">
      {children}
    </div>
  );
}

function Divider() {
  return <hr className="border-white/10 my-12" />;
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-xs bg-white/10 px-1.5 py-0.5 rounded text-white/80">
      {children}
    </code>
  );
}

function FeatureCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/55 leading-relaxed">{children}</p>
    </div>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Sticky top nav ──────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-black/90 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="text-xs text-white/50 hover:text-white/90 transition-colors whitespace-nowrap px-3 py-1.5 rounded-lg hover:bg-white/5"
              >
                {item.label}
              </a>
            ))}
          </div>
          <a
            href="#access"
            className="flex-shrink-0 text-xs font-medium bg-white text-black px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
          >
            Get API key
          </a>
        </div>
      </nav>

      <main className="px-6 py-16 max-w-3xl mx-auto">
        <Suspense fallback={null}>
          <CheckoutStatusBanner />
        </Suspense>

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="mb-14">
          <SectionLabel>Developer API</SectionLabel>
          <h1 className="text-4xl font-semibold tracking-tight mb-4">
            Ship AI safely or don&apos;t ship it at all.
          </h1>

          <p className="text-white text-2xl leading-tight tracking-tight mb-3 max-w-3xl">
            Zorelan is the verification layer that decides whether AI output is
            safe to execute — before it reaches users or systems.
          </p>

          <p className="text-white/65 text-lg leading-relaxed mb-5 max-w-3xl">
            In one API call, Zorelan compares multiple model outputs, scores
            trust, assesses risk, and returns a hard decision: allow, review, or
            block. Your application gates on <InlineCode>result.decision</InlineCode> — not on
            raw model output.
          </p>

          <p className="text-white/50 text-sm leading-relaxed mb-8 max-w-3xl">
            Trust → Risk → Decision → Execution
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard title="Show answer">
              High trust, acceptable risk, and clean alignment across providers.
            </FeatureCard>
            <FeatureCard title="Show with warning">
              Moderate trust or elevated uncertainty where the answer is useful
              but should not be presented as hard certainty.
            </FeatureCard>
            <FeatureCard title="Block or escalate">
              Low trust, high risk, or material disagreement where your product
              should fall back, ask for review, or avoid acting automatically.
            </FeatureCard>
          </div>
        </div>

        {/* ── Where Zorelan sits ────────────────────────────────────────────── */}
        <section className="mb-12">
          <SectionLabel>Where Zorelan sits</SectionLabel>
          <p className="text-white/60 leading-relaxed mb-4 max-w-2xl">
            Zorelan runs after model generation and before execution. It takes
            model outputs, evaluates agreement, risk, and context, and returns a
            deterministic decision your system can act on.
          </p>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-4 font-mono text-sm text-white/60 tracking-tight">
            User Input → Models → Zorelan → Decision → Execution
          </div>
          <p className="text-white/40 text-sm leading-relaxed mt-4">
            Use it as the final checkpoint before your system acts on AI output.
          </p>
        </section>

        {/* ── Change 3: Why Zorelan moved above quickstart ──────────────────── */}
        <section id="why" className="mb-12">
          <SectionLabel>Why this exists</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">
            Why not just use one model?
          </h2>

          <p className="text-white/60 leading-relaxed mb-6 max-w-2xl">
            A single model can generate an answer, but it does not tell you
            whether that answer deserves confidence. Zorelan compares multiple
            model outputs and returns a structured verification signal you can use
            to show, warn, block, or escalate responses in production.
          </p>

          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <FeatureCard title="Single model">
              One answer, no cross-check, no disagreement signal, and no reliable
              way to decide whether the output should drive product behaviour.
            </FeatureCard>

            <FeatureCard title="Zorelan">
              Multiple model outputs compared through semantic agreement analysis,
              with arbitration when disagreement matters.
            </FeatureCard>

            <FeatureCard title="Result">
              A trust-aware output your application can actually use: answer,
              score, risk, disagreement, and recommended action.
            </FeatureCard>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h2 className="text-lg font-semibold mb-3">
                  Use this in production
                </h2>
                <p className="text-white/60 leading-relaxed mb-4">
                  Zorelan is built for AI products that need more than a raw model
                  answer. Instead of trusting a single output, you get a decision
                  signal your application can act on.
                </p>
                <div className="space-y-2 text-sm text-white/55">
                  <div>• Verify answers before showing them in your UI</div>
                  <div>• Gate workflows on <code className="font-mono text-xs bg-white/10 px-1 rounded">result.decision</code> — allow, review, or block</div>
                  <div>• Surface uncertainty instead of hiding it</div>
                  <div>• Reduce single-model failure risk in production</div>
                </div>
              </div>
              <CodeBlock
                label="node.js · gate behaviour"
                code={integrationExample}
              />
            </div>
          </div>
        </section>

        <Divider />

        {/* ── Change 4: Quickstart — curl first ─────────────────────────────── */}
        <section id="quickstart" className="mb-12">
          <SectionLabel>Quickstart</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Make your first call</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            The fastest path is a single HTTP call. Send one prompt, get back a
            verified answer plus the confidence signals needed to decide how your
            product should use it.
          </p>

          <div className="space-y-4">
            {/* curl first */}
            <CodeBlock label="curl" code={curlExample} />
            <CodeBlock
              label="curl · advanced dual-prompt"
              code={advancedCurlExample}
            />
            <CodeBlock label="bash · sdk install" code={sdkInstallExample} />
            <CodeBlock label="node.js / typescript sdk" code={sdkQuickstartExample} />
            <CodeBlock label="python" code={pythonExample} />
          </div>
        </section>

        <section className="mb-12">
          <SectionLabel>Returned signals</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">What you get back</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard title="Verified answer">
              A synthesized final answer based on the strongest aligned provider
              outputs.
            </FeatureCard>
            <FeatureCard title="Trust score">
              A calibrated 0–100 signal that reflects agreement strength,
              disagreement severity, and domain risk.
            </FeatureCard>
            <FeatureCard title="Decision metadata">
              Risk level, consensus, disagreement type, recommended action,
              arbitration usage, provider diagnostics, and usage metadata.
            </FeatureCard>
          </div>
        </section>

        <section className="mb-12">
          <SectionLabel>Minimal response</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">
            The core fields most apps use
          </h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Most products do not need the full payload to get started. In many
            cases, these fields are enough to drive UI and routing decisions.
          </p>
          <CodeBlock
            label="json · minimal useful response"
            code={minimalResponseExample}
          />
        </section>

        <section className="mb-12">
          <SectionLabel>Use cases</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Where to use Zorelan</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <FeatureCard title="Validate AI before showing users">
              Verify responses before displaying them in your UI. Use trust score
              and risk level to decide whether to present an answer directly or
              expose uncertainty.
            </FeatureCard>
            <FeatureCard title="Gate actions on the decision field">
              Only trigger workflows, automations, notifications, or downstream
              decisions when <InlineCode>result.decision === &quot;allow&quot;</InlineCode>.
              The decision field already encodes risk, disagreement, and trust.
            </FeatureCard>
            <FeatureCard title="Reduce hallucinations in production">
              Add a verification layer between your app and LLMs to reduce
              fabricated or weak answers in higher-risk contexts.
            </FeatureCard>
            <FeatureCard title="Compare model behaviour">
              Inspect agreement, disagreement type, and arbitration results to
              understand how providers respond to the same prompt.
            </FeatureCard>
            <FeatureCard title="Add explainability to AI features">
              Return confidence and disagreement metadata alongside the answer so
              your product can communicate uncertainty clearly.
            </FeatureCard>
            <FeatureCard title="Build trust-aware product logic">
              Use trust score, risk level, and cached status as inputs into your
              application state, routing, or review flows.
            </FeatureCard>
          </div>
        </section>

        <Divider />

        <section className="mb-12">
          <SectionLabel>Authentication</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Authentication</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            All API requests must include your API key as a Bearer token in the{" "}
            <InlineCode>Authorization</InlineCode> header.
          </p>
          <CodeBlock
            label="http"
            code={`Authorization: Bearer YOUR_API_KEY
Content-Type: application/json`}
          />
          <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-5 py-4 text-sm text-white/60 leading-relaxed">
            ⚠ Keep your API key secret. Do not expose it in client-side code or
            public repositories. If compromised, contact us to rotate your key.
          </div>
        </section>

        <Divider />

        {/* ── API Reference ─────────────────────────────────────────────────── */}
        <section id="api-reference" className="mb-12">
          <SectionLabel>API Reference</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">POST /v1/decision</h2>
          <div className="rounded-2xl border border-white/10 p-5 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded font-semibold">
                POST
              </span>
              <span className="font-mono text-white/70 text-sm">
                https://zorelan.com/v1/decision
              </span>
            </div>
          </div>
          <p className="text-white/60 leading-relaxed">
            Submit a prompt for multi-model verification. Zorelan queries
            multiple AI providers, compares their responses, and returns a
            trust-calibrated result your application can act on.
          </p>
        </section>

        <section className="mb-12">
          <SectionLabel>Request modes</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">
            Simple mode and advanced mode
          </h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Most developers should start with simple mode. Advanced mode is useful
            when you want to optimize the provider-facing prompt without
            distorting trust calibration.
          </p>

          <div className="grid gap-4 md:grid-cols-2 mb-6">
            <FeatureCard title="Simple mode">
              Send one <InlineCode>prompt</InlineCode>. Zorelan uses it for both
              provider execution and calibration. This is the fastest way to get
              started and matches the original API contract.
            </FeatureCard>
            <FeatureCard title="Advanced mode">
              Send both <InlineCode>prompt</InlineCode> and{" "}
              <InlineCode>raw_prompt</InlineCode>. Use{" "}
              <InlineCode>prompt</InlineCode> as the execution prompt sent to
              providers, and <InlineCode>raw_prompt</InlineCode> as the original
              human question for task detection, risk classification, and trust
              scoring.
            </FeatureCard>
          </div>

          <InfoBox>
            Think of <InlineCode>prompt</InlineCode> as the execution prompt and{" "}
            <InlineCode>raw_prompt</InlineCode> as the original question used to
            keep confidence honest.
          </InfoBox>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Request body</h2>
          <Table
            headers={["Field", "Type", "Description"]}
            rows={[
              [
                <>
                  prompt{" "}
                  <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">
                    required
                  </span>
                </>,
                "string",
                "The execution prompt sent to AI providers. Plain natural language or a structured prompt. Max 10,000 characters.",
              ],
              [
                "raw_prompt",
                "string",
                "Optional. The original human question used for task detection, risk classification, and trust calibration. When omitted, Zorelan uses prompt for both execution and calibration.",
              ],
              [
                "cache_bypass",
                "boolean",
                "Optional. Set to true to force a fresh live verification, bypassing any cached result. Defaults to false.",
              ],
            ]}
          />
          <div className="mt-4 space-y-4">
            <CodeBlock
              label="json · simple request"
              code={`{
  "prompt": "Should I use HTTPS for my web application?"
}`}
            />
            <CodeBlock
              label="json · advanced request"
              code={advancedJsonExample}
            />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-6">Full response</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            All responses are JSON. A successful call returns{" "}
            <InlineCode>ok: true</InlineCode> with the full verification payload.
          </p>
          <CodeBlock label="json · full response" code={responseExample} />
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Response fields</h2>
          <Table
            headers={["Field", "Type", "Description"]}
            rows={responseFields.map(({ field, type, desc }) => [
              field,
              type,
              desc,
            ])}
          />
        </section>

        <Divider />

        <section className="mb-12">
          <SectionLabel>Decision layer</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">
            Gate execution on <InlineCode>result.decision</InlineCode>
          </h2>

          <p className="text-white/60 leading-relaxed mb-6">
            Every response includes a <InlineCode>decision</InlineCode> field
            that encodes the execution gate. Zorelan derives it from risk level,
            disagreement type, model alignment, and trust score — you do not need
            to re-implement this logic yourself. Branch on{" "}
            <InlineCode>decision</InlineCode> directly.
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            <FeatureCard title={`"allow"`}>
              Low risk, no material conflict, and trust score above threshold.
              Safe to act on automatically.
            </FeatureCard>
            <FeatureCard title={`"review"`}>
              Moderate risk, conditional alignment, or trust score below
              threshold. Route to human review before acting.
            </FeatureCard>
            <FeatureCard title={`"block"`}>
              High risk, material conflict, or a security-domain prompt. Do not
              act on this output without resolution.
            </FeatureCard>
          </div>
        </section>

        <Divider />

        {/* ── Trust scoring ─────────────────────────────────────────────────── */}
        <section id="trust" className="mb-12">
          <SectionLabel>How trust works</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">How trust scoring works</h2>

          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan does not just measure whether models agree. It measures
            whether that agreement deserves confidence.
          </p>

          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <FeatureCard title="Consensus">
              How closely the providers align in conclusion and reasoning. High
              consensus means the models broadly support the same answer. Low
              consensus means they materially diverge.
            </FeatureCard>

            <FeatureCard title="Risk level">
              Whether the prompt belongs to a domain where certainty is naturally
              limited. Factual questions tend to be lower risk. Strategic,
              comparative, and speculative prompts are often inherently more
              uncertain.
            </FeatureCard>

            <FeatureCard title="Trust score">
              The final calibrated confidence signal. It combines agreement
              strength, disagreement severity, and risk level to produce a score
              from 0–100.
            </FeatureCard>
          </div>

          <InfoBox>
            High agreement in an uncertain domain is not treated as ground truth.
          </InfoBox>

          <div className="mt-6 mb-6">
            <Table
              headers={[
                "Prompt",
                "Consensus",
                "Risk",
                "Trust score",
                "Interpretation",
              ]}
              rows={[
                [
                  "Is water made of hydrogen and oxygen?",
                  "High",
                  "Low",
                  "94–95",
                  "Objective fact with strong provider alignment.",
                ],
                [
                  "Should I use TypeScript or JavaScript for a new project?",
                  "High",
                  "Moderate",
                  "~85–88",
                  "Strong aligned reasoning, but still a context-dependent tradeoff.",
                ],
                [
                  "Is cryptocurrency a good long-term investment?",
                  "Mixed / bounded",
                  "Moderate to high",
                  "Lower / capped",
                  "Even aligned answers should not be presented as hard certainty.",
                ],
              ]}
            />
          </div>

          <div className="mt-4 mb-6">
            <Table
              headers={["Score range", "Interpretation", "How to use it"]}
              rows={[
                [
                  "90+",
                  "High-confidence factual or near-factual verification",
                  "Usually safe to rely on directly in product logic.",
                ],
                [
                  "~85",
                  "Strong aligned reasoning in an uncertain or tradeoff-heavy domain",
                  "Useful, but should still be treated as judgment rather than ground truth.",
                ],
                [
                  "Below 85",
                  "Material disagreement, ambiguity, or elevated uncertainty",
                  "Review before acting or expose uncertainty in the UI.",
                ],
              ]}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5 text-sm text-white/60 leading-relaxed space-y-3">
            <p>
              <span className="text-white/80 font-medium">Why this matters.</span>{" "}
              Most systems treat agreement as confidence. Zorelan separates the
              two. That makes the trust score more useful in production,
              especially for verification, decision support, and trust-aware
              downstream logic.
            </p>
            <p>
              Two models can strongly agree and still receive a bounded score if
              the prompt itself is inherently uncertain. This is intentional:
              Zorelan is designed to avoid presenting aligned speculation as hard
              certainty.
            </p>
            <p>
              When <InlineCode>raw_prompt</InlineCode> is provided, trust scoring
              is calibrated against the original human question, not just the
              optimized execution prompt sent to providers. This helps preserve
              honest confidence even when you use prompt engineering to improve
              answer quality.
            </p>
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Disagreement types</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan classifies the relationship between model responses into five
            types. This gives structured signal beyond a simple agree/disagree
            binary.
          </p>
          <Table
            headers={["Type", "Trust impact", "Description"]}
            rows={disagreementTypes.map(({ type, impact, desc }) => [
              type,
              impact,
              desc,
            ])}
          />
        </section>

        <section className="mb-12">
          <h2 className="text-xl font-semibold mb-4">Arbitration</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            When the initial two models disagree, Zorelan automatically invokes a
            third model to find the strongest pair. The{" "}
            <InlineCode>arbitration</InlineCode> field in the response tells you
            whether it was used, which provider was the tiebreaker, and the pair
            strength scores.
          </p>
          <CodeBlock
            label="arbitration logic"
            code={`Initial pair: Claude + Perplexity → LOW agreement
    ↓
Arbitration triggered
    ↓
Third model (GPT) queried
    ↓
Three pairs evaluated:
  Claude + Perplexity  → strength: 0
  Claude + GPT         → strength: 3  ← winner
  Perplexity + GPT     → strength: 2
    ↓
Active pair: Claude + GPT
Trust score recalculated on winning pair`}
          />
          <div className="mt-4">
            <InfoBox>
              Arbitration calls an additional provider when needed. It does not
              consume extra calls from your monthly quota — each request counts as
              one call regardless of whether arbitration is triggered.
            </InfoBox>
          </div>
        </section>

        <Divider />

        {/* ── How it works ──────────────────────────────────────────────────── */}
        <section id="how-it-works" className="mb-12">
          <SectionLabel>Overview</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">How it works</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan sits between your application and AI providers. When you call
            the API, Zorelan routes your prompt to multiple models
            simultaneously, compares their outputs using a semantic agreement
            engine, and returns a verified answer alongside a structured analysis
            of how the models agreed or disagreed.
          </p>
          <CodeBlock
            label="pipeline"
            code={`Your prompt
    ↓
Adaptive provider selection
    ↓
Parallel model queries (Claude · Perplexity · GPT)
    ↓
Semantic agreement judge (neutral cross-model)
    ↓
Arbitration if disagreement detected
    ↓
Trust score + verified answer`}
          />
          <p className="text-white/50 text-sm leading-relaxed mt-4">
            The semantic judge is always a different model family from the
            providers being compared — Claude judges OpenAI outputs, OpenAI
            judges Claude outputs. This eliminates self-scoring bias from the
            verification layer.
          </p>
        </section>

        <section className="mb-12">
          <SectionLabel>Execution vs Calibration</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">
            Prompt optimization without distorting trust
          </h2>

          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan supports both a provider-facing execution prompt and an
            original raw prompt for calibration. This allows you to optimize model
            performance without inflating confidence on inherently uncertain
            questions.
          </p>

          <div className="grid gap-4 md:grid-cols-2 mb-6">
            <FeatureCard title="prompt">
              The execution prompt sent to providers. Use this when you want to
              structure or optimize how the models answer.
            </FeatureCard>
            <FeatureCard title="raw_prompt">
              The original human question used for task detection, risk
              classification, and trust scoring. Use this when prompt engineering
              would otherwise distort confidence.
            </FeatureCard>
          </div>

          <CodeBlock
            label="dual-prompt model"
            code={`raw_prompt
    ↓
Task detection + risk classification + trust calibration

prompt
    ↓
Provider execution + synthesis

Result
    ↓
Better answers, honest trust scoring`}
          />

          <div className="mt-4">
            <InfoBox>
              If <InlineCode>raw_prompt</InlineCode> is omitted, Zorelan falls
              back to using <InlineCode>prompt</InlineCode> for both execution and
              calibration. This preserves backward compatibility with the original
              API contract.
            </InfoBox>
          </div>
        </section>

        <Divider />

        {/* ── Caching ───────────────────────────────────────────────────────── */}
        <section id="caching" className="mb-12">
          <SectionLabel>Caching</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Verified result caching</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan caches verified results for 6 hours. The first request for a
            given calibrated prompt path runs the full verification pipeline —
            querying multiple AI providers, running the semantic agreement judge,
            and producing a trust score. Subsequent identical requests within the
            cache window return the stored verified result instantly.
          </p>
          <InfoBox>
            A cached response is not an unverified response. It is a previously
            verified result being replayed. The full verification pipeline ran on
            the first request — the cache stores that output, not a shortcut
            around it.
          </InfoBox>
          <div className="mt-6">
            <Table
              headers={["Request", "Latency", "cached field"]}
              rows={[
                [
                  "First request (live verification)",
                  "~12–20s",
                  <span className="font-mono text-white/50 text-xs" key="live">
                    false
                  </span>,
                ],
                [
                  "Repeat request within 6 hours (cached)",
                  "~1–2s",
                  <span
                    className="font-mono text-emerald-400 text-xs"
                    key="cached"
                  >
                    true
                  </span>,
                ],
              ]}
            />
          </div>
          <p className="text-white/50 text-sm leading-relaxed mt-4">
            Every response includes a <InlineCode>cached</InlineCode> field so
            your application always knows whether it received a fresh live
            verification or a recently verified cached result. Cache keys are
            scoped to the calibrated prompt path and provider pair. When{" "}
            <InlineCode>raw_prompt</InlineCode> is provided, caching is anchored to
            that trust-calibration input.
          </p>
          <h3 className="text-base font-semibold mt-8 mb-3">
            Bypassing the cache
          </h3>
          <p className="text-white/60 leading-relaxed mb-4">
            To force a fresh live verification regardless of cache state, pass{" "}
            <InlineCode>cache_bypass: true</InlineCode> in the request body. This
            is useful when you need the most current provider outputs — for
            example, on time-sensitive prompts or after a known change in
            underlying facts.
          </p>
          <CodeBlock label="json · cache bypass" code={cacheBypassExample} />
          <div className="mt-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-5 py-4 text-sm text-white/60 leading-relaxed">
            ⚠ Cache bypass requests count against your monthly quota and run the
            full pipeline — expect normal verification latency.
          </div>
        </section>

        <Divider />

        {/* ── Errors ────────────────────────────────────────────────────────── */}
        <section id="errors" className="mb-12">
          <SectionLabel>Errors</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Error codes</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Zorelan uses standard HTTP status codes. All error responses include{" "}
            <InlineCode>ok: false</InlineCode> and an error code string.
          </p>
          <Table
            headers={["Status", "Error code", "Description"]}
            rows={errorCodes.map(({ status, code, desc }) => [
              status,
              code,
              desc,
            ])}
          />
          <div className="mt-4">
            <CodeBlock
              label="json · error response"
              code={`{
  "ok": false,
  "error": "rate_limit_exceeded",
  "plan": "starter",
  "calls_limit": 200,
  "calls_used": 200,
  "calls_remaining": 0
}`}
            />
          </div>
        </section>

        <Divider />

        <section className="mb-12">
          <SectionLabel>Account</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Rate limits</h2>
          <Table
            headers={["Scope", "Limit", "Window"]}
            rows={[
              ["Per API key", "10 requests", "10 seconds"],
              ["Per IP address", "30 requests", "10 seconds"],
              ["Monthly quota", "Plan limit", "Billing period"],
            ]}
          />
          <p className="text-white/50 text-sm leading-relaxed mt-4">
            When rate limited, the API returns HTTP 429 with a{" "}
            <InlineCode>retry_after</InlineCode> field indicating seconds to wait
            before retrying.
          </p>
        </section>

        <Divider />

        {/* ── Change 5: Feedback moved to bottom ───────────────────────────── */}
        <section id="feedback" className="mb-12">
          <SectionLabel>Feedback API</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Submit feedback</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            If Zorelan returns an incorrect verdict, you can submit feedback
            programmatically. Feedback is stored and reviewed to improve the
            verification engine.
          </p>

          <div className="rounded-2xl border border-white/10 p-5 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded font-semibold">
                POST
              </span>
              <span className="font-mono text-white/70 text-sm">
                https://zorelan.com/api/feedback
              </span>
            </div>
          </div>

          <p className="text-white/60 leading-relaxed mb-6">
            Accepts any valid API key or master key. Requires the original
            prompt, the verdict Zorelan returned, the issue type, and your
            correct answer.
          </p>

          <h3 className="text-base font-semibold mb-3">Request body</h3>
          <Table
            headers={["Field", "Type", "Required", "Description"]}
            rows={[
              [
                <>
                  prompt{" "}
                  <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">
                    required
                  </span>
                </>,
                "string",
                "Yes",
                "The original prompt you submitted to /v1/decision.",
              ],
              [
                <>
                  verdict{" "}
                  <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">
                    required
                  </span>
                </>,
                "string",
                "Yes",
                "The verdict Zorelan returned.",
              ],
              [
                <>
                  issue{" "}
                  <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">
                    required
                  </span>
                </>,
                "string",
                "Yes",
                <>
                  One of: <InlineCode>incorrect_verdict</InlineCode>{" · "}
                  <InlineCode>wrong_agreement_level</InlineCode>{" · "}
                  <InlineCode>missing_nuance</InlineCode>{" · "}
                  <InlineCode>other</InlineCode>
                </>,
              ],
              [
                <>
                  correct_answer{" "}
                  <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">
                    required
                  </span>
                </>,
                "string",
                "Yes",
                "What the correct answer should have been.",
              ],
              [
                "request_id",
                "string",
                "No",
                "The request ID from the original /v1/decision response, if available.",
              ],
              [
                "notes",
                "string",
                "No",
                "Any additional context about why the verdict was wrong.",
              ],
            ]}
          />

          <div className="mt-6">
            <CodeBlock label="curl · post feedback" code={feedbackPostExample} />
          </div>

          <div className="mt-4">
            <CodeBlock
              label="json · response"
              code={`{
  "ok": true,
  "id": "42d9ba4d-cab3-4721-83cb-06ae40c74562",
  "message": "Feedback received. Thank you."
}`}
            />
          </div>

          <h2 className="text-xl font-semibold mt-10 mb-4">Retrieve feedback</h2>

          <div className="rounded-2xl border border-white/10 p-5 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono bg-blue-500/15 text-blue-400 px-2 py-1 rounded font-semibold">
                GET
              </span>
              <span className="font-mono text-white/70 text-sm">
                https://zorelan.com/api/feedback
              </span>
            </div>
          </div>

          <p className="text-white/60 leading-relaxed mb-6">
            Returns all feedback records. Requires the master key — not available
            to regular API keys.
          </p>

          <CodeBlock label="curl · get feedback" code={feedbackGetExample} />
        </section>

        <Divider />

        {/* ── Change 6: Single pricing block ───────────────────────────────── */}
        <section id="access" className="mb-12">
          <SectionLabel>Access</SectionLabel>
          <h2 className="text-xl font-semibold mb-4">Get your API key</h2>
          <p className="text-white/60 leading-relaxed mb-6">
            Subscribe below to receive your API key instantly. All plans include
            full API access with the same response schema, trust scoring, and
            arbitration.
          </p>
          <div className="rounded-2xl border border-white/10 p-6">
            <PricingButtons />
          </div>
        </section>
      </main>
    </div>
  );
}