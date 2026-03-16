import type { Metadata } from "next";
import { Suspense } from "react";
import PricingButtons from "./PricingButtons";
import CheckoutStatusBanner from "./CheckoutStatusBanner";

export const metadata: Metadata = {
  title: "API Docs — Zorelan",
  description:
    "Integrate Zorelan's AI verification engine into your app with a single API call.",
};

const curlExample = `curl -X POST https://zorelan.com/v1/decision \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Should I use microservices or a monolith for my startup?"}'`;

const nodeExample = `const response = await fetch("https://zorelan.com/v1/decision", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${process.env.ZORELAN_API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    prompt: "Should I use microservices or a monolith for my startup?",
  }),
});

const data = await response.json();

console.log(data.verified_answer);    // synthesized answer
console.log(data.trust_score.score);  // 0–100
console.log(data.consensus.level);    // "high" | "medium" | "low"
console.log(data.cached);             // true if result was cached`;

const pythonExample = `import requests
import os

response = requests.post(
    "https://zorelan.com/v1/decision",
    headers={
        "Authorization": f"Bearer {os.environ['ZORELAN_API_KEY']}",
        "Content-Type": "application/json",
    },
    json={
        "prompt": "Should I use microservices or a monolith for my startup?",
    }
)

data = response.json()
print(data["verified_answer"])
print(data["trust_score"]["score"])
print(data["consensus"]["level"])
print(data["cached"])  # True if result was cached`;

const responseExample = `{
  "ok": true,
  "verified_answer": "Start with a monolith. Both models strongly recommend...",
  "verdict": "Both responses recommend starting with a monolith architecture.",
  "consensus": {
    "level": "high",
    "models_aligned": 2
  },
  "trust_score": {
    "score": 83,
    "label": "high",
    "reason": "The original answers support the same main conclusion..."
  },
  "risk_level": "low",
  "confidence": "high",
  "confidence_reason": "Both models reached the same core conclusion...",
  "key_disagreement": "No meaningful difference in conclusion.",
  "recommended_action": "Use the shared conclusion as the answer.",
  "cached": false,
  "providers_used": ["anthropic", "perplexity"],
  "verification": {
    "final_conclusion_aligned": true,
    "disagreement_type": "none",
    "semantic_label": "HIGH_AGREEMENT",
    "semantic_rationale": "Both answers strongly advocate starting with a monolith...",
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
    "anthropic": { "quality_score": 9, "duration_ms": 4571, "timed_out": false },
    "perplexity": { "quality_score": 8, "duration_ms": 5158, "timed_out": false }
  },
  "meta": {
    "task_type": "strategy",
    "overlap_ratio": 0.34,
    "agreement_summary": "The two model outputs support the same main conclusion.",
    "prompt_chars": 58,
    "likely_conflict": false,
    "disagreement_type": "none"
  },
  "usage": {
    "plan": "pro",
    "calls_limit": 1000,
    "calls_used": 42,
    "calls_remaining": 958,
    "status": "active"
  }
}`;

const cacheBypassExample = `{
  "prompt": "Should I use microservices or a monolith for my startup?",
  "cache_bypass": true
}`;

const feedbackPostExample = `curl -X POST https://zorelan.com/api/feedback \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Should I use microservices or a monolith?",
    "verdict": "Both models recommend a monolith.",
    "issue": "incorrect_verdict",
    "correct_answer": "Microservices are better for this use case.",
    "request_id": "req_abc123",
    "notes": "The prompt was about a high-scale system."
  }'`;

const feedbackGetExample = `curl https://zorelan.com/api/feedback \\
  -H "Authorization: Bearer YOUR_MASTER_KEY"`;

const responseFields = [
  { field: "verified_answer", type: "string", desc: "The synthesized final answer combining the best insights from all models." },
  { field: "verdict", type: "string", desc: "A concise one-sentence decision verdict." },
  { field: "consensus.level", type: "string", desc: '"high" · "medium" · "low" — how strongly the models agreed.' },
  { field: "consensus.models_aligned", type: "number", desc: "Number of models that reached the same conclusion." },
  { field: "trust_score.score", type: "number", desc: "Overall reliability score from 0–100. Driven by agreement level, quality, and risk." },
  { field: "trust_score.label", type: "string", desc: '"high" (≥75) · "moderate" (≥55) · "low" (<55)' },
  { field: "trust_score.reason", type: "string", desc: "Plain English explanation of why the score is what it is." },
  { field: "risk_level", type: "string", desc: '"low" · "moderate" · "high" — assessed risk of acting on this answer.' },
  { field: "key_disagreement", type: "string", desc: "The main tension, tradeoff, or difference between the model responses." },
  { field: "recommended_action", type: "string", desc: "Practical guidance on how to use this answer." },
  { field: "cached", type: "boolean", desc: 'false on a fresh live verification. true when the result was served from cache — meaning this exact prompt was verified within the last 6 hours and the stored result is being returned. Use cache_bypass: true to force a fresh verification.' },
  { field: "providers_used", type: "string[]", desc: "The AI providers queried for this request." },
  { field: "verification.disagreement_type", type: "string", desc: "Structured classification of how models differed. See disagreement types below." },
  { field: "verification.semantic_judge_model", type: "string", desc: "Which model performed the neutral semantic judgment." },
  { field: "arbitration.used", type: "boolean", desc: "Whether a third model was invoked to resolve disagreement." },
  { field: "model_diagnostics", type: "object", desc: "Per-provider quality scores, latency, and timeout status." },
  { field: "meta.task_type", type: "string", desc: '"technical" · "strategy" · "creative" · "general" — detected category of the prompt.' },
  { field: "usage", type: "object", desc: "Your current plan, call limits, and remaining calls for the billing period." },
];

const errorCodes = [
  { status: "400", code: "missing_prompt", desc: 'The request body is missing the required "prompt" field.' },
  { status: "400", code: "prompt_too_large", desc: "The prompt exceeds 10,000 characters." },
  { status: "401", code: "unauthorized", desc: "Missing or invalid API key." },
  { status: "403", code: "subscription_inactive", desc: "Your subscription is inactive. Check your billing at zorelan.com." },
  { status: "429", code: "rate_limit_exceeded", desc: "You have used all calls for this billing period." },
  { status: "429", code: "too_many_requests", desc: 'Too many requests in a short window. Includes a "retry_after" field in seconds.' },
  { status: "500", code: "internal_error", desc: "An unexpected server error. Retry with exponential backoff." },
];

const disagreementTypes = [
  { type: "none", impact: "No penalty", desc: "Models reached the same conclusion with no meaningful difference." },
  { type: "additive_nuance", impact: "No penalty", desc: "One model added correct detail without changing the core conclusion." },
  { type: "explanation_variation", impact: "−4 pts", desc: "Same conclusion, different framing, emphasis, or supporting reasoning." },
  { type: "conditional_alignment", impact: "−12 pts", desc: "A usable answer exists only by adding context or conditions. Models didn't cleanly agree." },
  { type: "material_conflict", impact: "−20 pts", desc: "Models gave materially opposite recommendations or conclusions." },
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

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-16 max-w-3xl mx-auto">
      <Suspense fallback={null}>
        <CheckoutStatusBanner />
      </Suspense>

      {/* Hero */}
      <div className="mb-14">
        <SectionLabel>Developer API</SectionLabel>
        <h1 className="text-4xl font-semibold tracking-tight mb-4">
          Zorelan API
        </h1>
        <p className="text-white/60 text-lg leading-relaxed mb-8">
          Send one prompt. Get a verified answer from multiple AI models — with
          a trust score, consensus level, and structured disagreement analysis
          — in a single API call.
        </p>
        <div className="flex flex-wrap gap-8">
          {[
            { value: "3", label: "AI providers compared" },
            { value: "0–100", label: "Trust score range" },
            { value: "5", label: "Disagreement types" },
            { value: "89%", label: "Agreement accuracy · 100-question benchmark" },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-semibold font-mono">{value}</div>
              <div className="text-xs text-white/40 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <Divider />

      {/* How it works */}
      <section className="mb-12">
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

      <Divider />

      {/* Access */}
      <section className="mb-12">
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

      <Divider />

      {/* Authentication */}
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

      {/* Endpoint */}
      <section className="mb-12">
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
          multiple AI providers, semantically compares their responses, and
          returns a verified answer with full analysis.
        </p>
      </section>

      {/* Request */}
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
              "The question or decision you want verified. Plain natural language. Max 10,000 characters.",
            ],
            [
              "cache_bypass",
              "boolean",
              "Optional. Set to true to force a fresh live verification, bypassing any cached result. Defaults to false.",
            ],
          ]}
        />
        <div className="mt-4">
          <CodeBlock
            label="json · request"
            code={`{
  "prompt": "Should I use microservices or a monolith for my startup?"
}`}
          />
        </div>
      </section>

      {/* Quickstart */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-6">Quickstart examples</h2>
        <div className="space-y-4">
          <CodeBlock label="curl" code={curlExample} />
          <CodeBlock label="node.js / typescript" code={nodeExample} />
          <CodeBlock label="python" code={pythonExample} />
        </div>
      </section>

      {/* Response */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">Response</h2>
        <p className="text-white/60 leading-relaxed mb-6">
          All responses are JSON. A successful call returns{" "}
          <InlineCode>ok: true</InlineCode> with the full verification payload.
        </p>
        <CodeBlock label="json · response" code={responseExample} />
      </section>

      {/* Response fields */}
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

      {/* Caching */}
      <section className="mb-12">
        <SectionLabel>Caching</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">Verified result caching</h2>
        <p className="text-white/60 leading-relaxed mb-6">
          Zorelan caches verified results for 6 hours. The first request for a
          given prompt runs the full verification pipeline — querying multiple
          AI providers, running the semantic agreement judge, and producing a
          trust score. Subsequent identical requests within the cache window
          return the stored verified result instantly.
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
              ["First request (live verification)", "~12–20s", <span className="font-mono text-white/50 text-xs">false</span>],
              ["Repeat request within 6 hours (cached)", "~1–2s", <span className="font-mono text-emerald-400 text-xs">true</span>],
            ]}
          />
        </div>
        <p className="text-white/50 text-sm leading-relaxed mt-4">
          Every response includes a <InlineCode>cached</InlineCode> field so
          your application always knows whether it received a fresh live
          verification or a recently verified cached result. Cache keys are
          scoped to the prompt and provider pair — different provider
          combinations produce separate cache entries.
        </p>
        <h3 className="text-base font-semibold mt-8 mb-3">Bypassing the cache</h3>
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

      {/* Errors */}
      <section className="mb-12">
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

      {/* Trust score */}
      <section className="mb-12">
        <SectionLabel>Concepts</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">Trust score</h2>
        <p className="text-white/60 leading-relaxed mb-6">
          The trust score is a 0–100 number representing how reliable the
          verified answer is. It is calculated from two components with no
          arbitrary floor constants or inflated minimums — a low-agreement
          result genuinely produces a low score.
        </p>
        <Table
          headers={["Component", "Weight", "Description"]}
          rows={[
            [
              "Agreement level",
              "65%",
              "How strongly the models agreed. High = base 85, Medium = 65, Low = 35.",
            ],
            [
              "Output quality",
              "35%",
              "Per-response quality from 1–10, scored by a neutral cross-model judge. Claude scores OpenAI outputs, OpenAI scores Claude outputs.",
            ],
          ]}
        />
        <div className="mt-4 mb-6">
          <Table
            headers={["Score", "Label", "Interpretation"]}
            rows={[
              ["75–100", '"high"', "Strong model agreement. Safe to act on."],
              [
                "55–74",
                '"moderate"',
                "Partial agreement. Review key disagreements before acting.",
              ],
              [
                "0–54",
                '"low"',
                "Models diverged. Treat the answer as a starting point, not a conclusion.",
              ],
            ]}
          />
        </div>
        <InfoBox>
          Penalties reduce the score for disagreement type (−4 to −20 points),
          misaligned conclusions (−10 points), and elevated risk level (−5 to
          −15 points).
        </InfoBox>

        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] px-5 py-5 text-sm text-white/60 leading-relaxed space-y-3">
          <p>
            <span className="text-white/80 font-medium">Benchmark results.</span>{" "}
            Tested across 100 questions spanning factual, technical, strategy,
            health, finance, and controversial topics — Zorelan correctly
            assessed agreement level in{" "}
            <span className="text-white/90 font-semibold">89% of cases</span>,
            with 100% accuracy on factual questions and strong performance on
            technical and developer questions.
          </p>
          <p>
            A key finding: AI models agree far more than humans expect, even on
            controversial topics. Models trained for balance tend to converge on
            nuanced positions rather than taking opposing sides. Zorelan detects
            this convergence accurately.
          </p>
        </div>
      </section>

      {/* Disagreement types */}
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

      {/* Arbitration */}
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

      {/* Rate limits */}
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

      {/* Feedback API */}
      <section className="mb-12">
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
              <>prompt <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">required</span></>,
              "string",
              "Yes",
              "The original prompt you submitted to /v1/decision.",
            ],
            [
              <>verdict <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">required</span></>,
              "string",
              "Yes",
              "The verdict Zorelan returned.",
            ],
            [
              <>issue <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">required</span></>,
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
              <>correct_answer <span className="text-red-400/80 text-[10px] border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded ml-1">required</span></>,
              "string",
              "Yes",
              "What the correct answer should have been.",
            ],
            ["request_id", "string", "No", "The request ID from the original /v1/decision response, if available."],
            ["notes", "string", "No", "Any additional context about why the verdict was wrong."],
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

      {/* CTA */}
      <section>
        <div className="rounded-2xl border border-white/10 p-8 text-center space-y-4">
          <h2 className="text-xl font-semibold">Ready to integrate?</h2>
          <p className="text-white/50">
            Choose a plan and start building in minutes.
          </p>
          <PricingButtons />
        </div>
      </section>
    </main>
  );
}