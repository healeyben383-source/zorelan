import type { Metadata } from "next";
import { Suspense } from "react";
import PricingButtons from "./PricingButtons";
import CheckoutStatusBanner from "./CheckoutStatusBanner";

export const metadata: Metadata = {
  title: "API Docs — Zorelan",
  description:
    "Zorelan is an AI verification engine and consensus layer for production systems. Compare multiple model responses and return a verified answer with trust scoring and disagreement analysis.",
};

const sdkInstallExample = `npm install @zorelan/sdk`;

const sdkQuickstartExample = `import { Zorelan } from "@zorelan/sdk";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY!);

const result = await zorelan.verify(
  "Should I use HTTPS for my web application?"
);

console.log(result.verified_answer);
console.log(result.trust_score.score);
console.log(result.consensus.level);`;

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

const responseExample = `{
  "ok": true,
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

// Gate behaviour based on trust score
if (result.trust_score.score >= 75) {
  showAnswer(result.verified_answer);
} else {
  showWarning("Low confidence. Review before acting.");
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
    <main className="min-h-screen bg-black text-white px-6 py-16 max-w-3xl mx-auto">
      <Suspense fallback={null}>
        <CheckoutStatusBanner />
      </Suspense>

      <div className="mb-14">
        <SectionLabel>Developer API</SectionLabel>
        <h1 className="text-4xl font-semibold tracking-tight mb-4">
          Zorelan API
        </h1>

        <p className="text-white text-2xl leading-tight tracking-tight mb-2 max-w-3xl">
          Zorelan is an AI verification engine.
        </p>

        <p className="text-white/40 text-sm mb-5">
          AI verification infrastructure for production systems.
        </p>

        <p className="text-white/70 text-lg leading-relaxed mb-4 max-w-3xl">
          It compares multiple model responses and returns a verified answer with
          calibrated trust scoring, consensus signals, and disagreement analysis
          in a single API call.
        </p>

        <p className="text-white/55 text-base leading-relaxed mb-8 max-w-3xl">
          Most AI applications rely on a single model output. Zorelan adds a{" "}
          <span className="text-white font-medium">verification layer</span>{" "}
          between your app and AI providers, helping reduce hallucinations,
          expose disagreement, and increase confidence before you act on an
          answer.
        </p>

        <div className="flex flex-wrap gap-8">
          {[
            { value: "3", label: "AI providers compared" },
            { value: "0–100", label: "Trust score range" },
            { value: "5", label: "Disagreement types" },
            {
              value: "89%",
              label: "Agreement classification accuracy",
            },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-semibold font-mono">{value}</div>
              <div className="text-xs text-white/40 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="mb-12">
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-lg font-semibold mb-3">What Zorelan does</h2>
              <p className="text-white/60 leading-relaxed mb-4">
                Send one prompt to Zorelan. It queries multiple AI models,
                compares their outputs, and returns a verified answer with
                machine-readable confidence signals.
              </p>
              <div className="space-y-2 text-sm text-white/55">
                <div>• Reduces single-model failure risk</div>
                <div>• Surfaces model agreement and disagreement</div>
                <div>• Returns a trust score you can use in product logic</div>
                <div>• Adds a verification layer to AI-powered apps</div>
              </div>
            </div>

            <CodeBlock
              label="mental model"
              code={`Your App
    ↓
Zorelan (verification layer)
    ↓
Multiple AI models
    ↓
Agreement + arbitration
    ↓
Verified answer + trust score`}
            />
          </div>
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Quickstart</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">Install the SDK</h2>
        <p className="text-white/60 leading-relaxed mb-6">
          Zorelan verifies AI responses by comparing multiple models and
          returning confidence signals you can use in your product. The fastest
          way to integrate is through the TypeScript SDK.
        </p>

        <div className="space-y-4">
          <CodeBlock label="bash" code={sdkInstallExample} />
          <CodeBlock label="node.js / typescript" code={sdkQuickstartExample} />
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Outputs</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">What you get back</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Verified answer">
            A synthesized final answer based on the strongest aligned model
            outputs.
          </FeatureCard>
          <FeatureCard title="Trust score">
            A calibrated 0–100 confidence signal based on consensus,
            disagreement severity, and domain risk.
          </FeatureCard>
          <FeatureCard title="Structured analysis">
            Consensus level, risk level, disagreement type, arbitration usage,
            provider diagnostics, and usage metadata.
          </FeatureCard>
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Use Cases</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">Where to use Zorelan</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <FeatureCard title="Validate AI before showing users">
            Verify responses before displaying them in your UI. Use trust score
            and consensus level to decide whether to present an answer directly
            or show uncertainty.
          </FeatureCard>
          <FeatureCard title="Gate actions based on confidence">
            Only trigger workflows, automations, notifications, or downstream
            decisions when the trust score clears your threshold.
          </FeatureCard>
          <FeatureCard title="Reduce hallucinations in production">
            Add a verification layer between your app and LLMs to reduce
            fabricated or weak answers in higher-risk contexts.
          </FeatureCard>
          <FeatureCard title="Compare model behaviour">
            Inspect agreement, disagreement type, and arbitration results to
            understand how different providers respond to the same prompt.
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

      <section className="mb-12">
        <SectionLabel>Example</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">
          Using Zorelan in a product
        </h2>

        <p className="text-white/60 leading-relaxed mb-6">
          A common pattern is to verify AI responses before showing them to
          users or triggering actions. Zorelan acts as a verification layer
          between your app and AI models, allowing you to gate behaviour based
          on confidence.
        </p>

        <CodeBlock
          label="node.js · verify before display"
          code={integrationExample}
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <FeatureCard title="High confidence">
            Show the verified answer directly when models strongly agree.
          </FeatureCard>

          <FeatureCard title="Low confidence">
            Flag uncertainty, request confirmation, or trigger fallback logic.
          </FeatureCard>
        </div>
      </section>

      <section className="mb-12">
        <SectionLabel>Positioning</SectionLabel>
        <h2 className="text-xl font-semibold mb-4">
          Why not just use one model?
        </h2>

        <p className="text-white/60 leading-relaxed mb-6 max-w-2xl">
          A single model can give you a fast answer — but it gives you no
          built-in verification layer. You do not know if it is correct,
          partially correct, or confidently wrong. Zorelan compares multiple
          model outputs and returns a structured confidence signal you can use
          in your product. Crucially, it does not treat model agreement as
          automatic certainty.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard title="Single model">
            One answer. No cross-check. No visibility into agreement or
            disagreement.
          </FeatureCard>

          <FeatureCard title="Zorelan">
            Multiple model outputs compared and verified using a semantic
            agreement engine.
          </FeatureCard>

          <FeatureCard title="Result">
            Trust-aware outputs with scores, consensus signals, and structured
            disagreement analysis.
          </FeatureCard>
        </div>
      </section>

      <Divider />

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
        <h2 className="text-xl font-semibold mb-6">Quickstart examples</h2>
        <div className="space-y-4">
          <CodeBlock label="curl" code={curlExample} />
          <CodeBlock label="curl · advanced dual-prompt" code={advancedCurlExample} />
          <CodeBlock label="node.js / typescript SDK" code={nodeExample} />
          <CodeBlock label="python" code={pythonExample} />
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xl font-semibold mb-4">Response</h2>
        <p className="text-white/60 leading-relaxed mb-6">
          All responses are JSON. A successful call returns{" "}
          <InlineCode>ok: true</InlineCode> with the full verification payload.
        </p>
        <CodeBlock label="json · response" code={responseExample} />
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

      <section className="mb-12">
        <SectionLabel>Concepts</SectionLabel>
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