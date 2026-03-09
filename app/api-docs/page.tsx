import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Docs — Zorelan",
  description: "Integrate Zorelan's AI verification engine into your app with a single API call.",
};

const requestExample = `{
  "prompt": "Should I charge hourly or fixed pricing for my business?"
}`;

const responseExample = `{
  "ok": true,
  "verified_answer": "Fixed pricing is generally more effective...",
  "confidence": "high",
  "confidence_reason": "Both models independently reached the same conclusion.",
  "providers_used": ["anthropic", "perplexity"],
  "model_diagnostics": {
    "anthropic": { "quality_score": 8, "duration_ms": 5200 },
    "perplexity": { "quality_score": 7, "duration_ms": 4800 }
  },
  "meta": {
    "task_type": "strategy",
    "overlap_ratio": 0.82,
    "agreement_summary": "Both models recommend fixed pricing for recurring services."
  }
}`;

const curlExample = `curl -X POST https://zorelan.com/api/decision \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Should I hire staff or stay solo?"}'`;

const fields = [
  ["verified_answer", "The synthesized final answer combining the best of both models."],
  ["confidence", "high / medium / low — how much the models agreed."],
  ["confidence_reason", "A plain English explanation of the confidence level."],
  ["providers_used", "Which AI models were selected for this query."],
  ["model_diagnostics", "Quality score and response time per provider."],
  ["meta.task_type", "The detected category of your query (strategy, technical, creative, general)."],
  ["meta.overlap_ratio", "0.0–1.0 score of how similar the two model outputs were."],
  ["meta.agreement_summary", "A one-line summary of how the models compared."],
];

export default function ApiDocsPage() {
  return (
    <main className="min-h-screen bg-black text-white px-6 py-16 max-w-3xl mx-auto">
      <div className="mb-12">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-3">Developer API</div>
        <h1 className="text-4xl font-semibold tracking-tight mb-4">Zorelan API</h1>
        <p className="text-white/60 text-lg leading-relaxed">
          Get a verified, multi-model AI answer in a single API call. Zorelan runs multiple AI models,
          compares their outputs, and returns a synthesized answer with a confidence score.
        </p>
      </div>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Access</h2>
        <div className="rounded-2xl border border-white/10 p-6 space-y-3">
          <p className="text-white/80">The API is currently in early access. To request an API key, email:</p>
          <a href="mailto:api@zorelan.com" className="inline-block text-white font-medium underline underline-offset-4">
            api@zorelan.com
          </a>
          <p className="text-white/40 text-sm">We will get back to you within 24 hours.</p>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Endpoint</h2>
        <div className="rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono bg-white/10 text-white px-2 py-1 rounded">POST</span>
            <span className="font-mono text-white/80">https://zorelan.com/api/decision</span>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Request Body</h2>
        <div className="rounded-2xl border border-white/10 p-6">
          <pre className="text-sm font-mono text-white/80 whitespace-pre-wrap">{requestExample}</pre>
        </div>
        <div className="mt-4 text-sm flex gap-4">
          <span className="font-mono text-white/60 w-20">prompt</span>
          <span className="text-white/40">string — required. The question or decision you want verified.</span>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Response</h2>
        <div className="rounded-2xl border border-white/10 p-6">
          <pre className="text-sm font-mono text-white/80 whitespace-pre-wrap">{responseExample}</pre>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Response Fields</h2>
        <div className="rounded-2xl border border-white/10 divide-y divide-white/10">
          {fields.map(([field, desc]) => (
            <div key={field} className="flex gap-4 px-6 py-4 text-sm">
              <span className="font-mono text-white/60 w-48 shrink-0">{field}</span>
              <span className="text-white/40">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-xs uppercase tracking-widest text-white/40 mb-4">Example Request</h2>
        <div className="rounded-2xl border border-white/10 p-6">
          <pre className="text-sm font-mono text-white/80 whitespace-pre-wrap">{curlExample}</pre>
        </div>
      </section>

      <section>
        <div className="rounded-2xl border border-white/10 p-8 text-center space-y-4">
          <h2 className="text-xl font-semibold">Ready to integrate?</h2>
          <p className="text-white/50">Request early access and we will set you up within 24 hours.</p>
          
            <a
            href="mailto:api@zorelan.com"
            className="inline-block bg-white text-black font-medium px-6 py-3 rounded-full hover:bg-white/90 transition-colors"
          >
            Request API Access
          </a>
        </div>
      </section>
    </main>
  );
}