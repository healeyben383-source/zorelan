import HeroVideo from "@/components/hero-video";

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@zorelan.com";

const proposedActionExample = `{
  "type": "refund_customer",
  "parameters": { "amount": 180, "currency": "AUD" },
  "reversible": false,
  "context": { "order_status": "delivery_unconfirmed" }
}`;

const developerSnippet = `const decision = await zorelan.evaluateAction({
  user_request,
  model_output,
  proposed_action,
  policy,
});

if (decision.verdict === "ALLOW")  executeAction();
if (decision.verdict === "REVIEW") routeToHumanReview();
if (decision.verdict === "BLOCK")  blockExecution();`;

function Arrow() {
  return <span className="opacity-30">→</span>;
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-1 whitespace-nowrap">
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-widest opacity-40 font-medium">
      {children}
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/[0.02] dark:bg-white/[0.02] space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-sm opacity-65 leading-relaxed">{children}</p>
    </div>
  );
}

const PRIMARY_BTN =
  "inline-flex items-center justify-center rounded-2xl bg-white text-black px-4 py-3 text-sm font-medium shadow-sm hover:shadow-md transition-all";
const SECONDARY_BTN =
  "inline-flex items-center justify-center rounded-2xl border border-black/10 dark:border-white/10 px-4 py-3 text-sm font-medium opacity-85 hover:opacity-100 transition-all";

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-5xl space-y-16 md:space-y-24">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="space-y-10 md:space-y-14">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl md:text-2xl font-semibold tracking-tight">
              Zorelan
            </div>
            <nav className="flex items-center gap-2">
              <a
                href="/demo"
                className="flex items-center rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
              >
                Demo
              </a>
              <a
                href="/api-docs"
                className="flex items-center rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
              >
                API Docs
              </a>
            </nav>
          </div>

          {/* Hero */}
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div className="space-y-5 text-center lg:text-left">
              <p className="text-xs uppercase tracking-widest opacity-40 font-medium">
                Execution decision layer
              </p>
              <h1 className="text-[2.5rem] leading-[1.02] font-semibold tracking-tight md:text-6xl md:leading-[0.98]">
                AI can be right — and still trigger the wrong action.
              </h1>
              <p className="text-base md:text-lg opacity-70 leading-relaxed max-w-xl mx-auto lg:mx-0">
                Zorelan evaluates proposed AI actions against your policy and
                returns <strong>ALLOW</strong>, <strong>REVIEW</strong>, or{" "}
                <strong>BLOCK</strong> — before anything hits your backend.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start pt-1">
                <a href="/demo" className={PRIMARY_BTN}>
                  Try the structured demo
                </a>
                <a href="/api-docs" className={SECONDARY_BTN}>
                  Read API docs
                </a>
              </div>
              <p className="text-xs opacity-45 tracking-wide">
                No signup required to try the demo.
              </p>
            </div>

            <div className="flex justify-center lg:justify-end">
              <HeroVideo />
            </div>
          </div>
        </header>

        {/* ── Pipeline ───────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-wide opacity-50">
            Where Zorelan sits
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm font-mono opacity-75">
            <Step>User request</Step>
            <Arrow />
            <Step>AI output</Step>
            <Arrow />
            <Step>Proposed action</Step>
            <Arrow />
            <Step>Zorelan policy check</Step>
            <Arrow />
            <Step>ALLOW / REVIEW / BLOCK</Step>
            <Arrow />
            <Step>Execute · review · block</Step>
          </div>
          <p className="text-sm opacity-60 max-w-2xl leading-relaxed">
            Zorelan runs after model generation and before execution. It does
            not replace your models — it decides whether their proposed actions
            are safe to run.
          </p>
        </section>

        {/* ── Concrete example: refund BLOCK ─────────────────────────────── */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-wide opacity-50">
            Example — refund before delivery is confirmed
          </div>
          <p className="text-sm md:text-base font-medium opacity-85">
            Correct-sounding reply. Unsafe action.
          </p>

          <div className="grid md:grid-cols-2 gap-4 items-start">
            {/* What the AI proposed */}
            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/[0.02] dark:bg-white/[0.02] space-y-4">
              <div className="space-y-2">
                <Label>AI model output</Label>
                <p className="text-sm opacity-80 leading-relaxed">
                  {`“I have issued your full refund of $180.”`}
                </p>
              </div>
              <div className="space-y-2">
                <Label>proposed_action</Label>
                <pre className="text-xs font-mono opacity-70 leading-relaxed whitespace-pre-wrap break-words">
                  {proposedActionExample}
                </pre>
              </div>
              <div className="space-y-2">
                <Label>policy.controls.refund</Label>
                <ul className="text-xs opacity-70 leading-relaxed list-disc ml-4 space-y-1">
                  <li>auto_allow_limit: $100 AUD</li>
                  <li>absolute_review_limit: $1,000 AUD</li>
                  <li>require_delivery_confirmation_above_auto_allow_limit: true</li>
                </ul>
              </div>
            </div>

            {/* Zorelan decision */}
            <div className="rounded-2xl border-2 border-red-500/40 overflow-hidden">
              <div className="bg-red-600 text-white text-center py-5">
                <div className="text-3xl font-black tracking-wide">BLOCK</div>
                <div className="text-xs opacity-85 mt-1">Do not execute</div>
              </div>
              <div className="p-5 space-y-4">
                <div className="space-y-1">
                  <Label>Reason</Label>
                  <p className="text-sm opacity-80 leading-relaxed">
                    Refund of $180 is above the policy&apos;s auto-allow limit
                    ($100) and delivery is not confirmed.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Missing context</Label>
                  <p className="text-sm opacity-80 leading-relaxed">
                    <code className="font-mono text-xs">delivery_confirmed</code>{" "}
                    — required for refunds above the auto-allow limit.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label>Next step</Label>
                  <p className="text-sm opacity-80 leading-relaxed">
                    Block execution. Request delivery confirmation, then
                    re-evaluate.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs opacity-50">
            See the full interactive flow in the{" "}
            <a href="/demo" className="underline underline-offset-2">
              structured demo →
            </a>
          </p>
        </section>

        {/* ── Developer snippet ──────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-wide opacity-50">
            For developers
          </div>
          <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
            One call, before the action runs
          </h2>
          <p className="text-sm opacity-65 max-w-2xl leading-relaxed">
            Send the proposed action and the policy it must satisfy. Branch on
            the verdict.
          </p>
          <pre className="rounded-xl border border-white/10 bg-black text-white text-xs leading-relaxed p-4 overflow-x-auto">
            {developerSnippet}
          </pre>
          <p className="text-xs opacity-50">
            Gate execution on <code className="font-mono">decision.verdict</code>.
            Full reference in the{" "}
            <a href="/api-docs" className="underline underline-offset-2">
              API docs →
            </a>
          </p>
        </section>

        {/* ── How decisions are made ─────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="text-xs uppercase tracking-wide opacity-50">
            How decisions are made
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Deterministic policy checks">
              For common high-risk action types — refunds, account deletion,
              subscription changes, CRM updates — Zorelan applies explicit,
              repeatable policy checks rather than a model guess.
            </Card>
            <Card title="Explicit policy matches">
              Every decision shows which rules were satisfied or violated, and
              why — not an opaque score.
            </Card>
            <Card title="Missing-context detection">
              When a decision depends on information you did not send (such as
              delivery confirmation), Zorelan surfaces it as missing context
              instead of guessing.
            </Card>
            <Card title="Fail-safe by default">
              Unknown action types return REVIEW, never an automatic ALLOW.
            </Card>
          </div>
          <p className="text-xs opacity-50 max-w-2xl leading-relaxed">
            Prompt verification (multi-model comparison and trust score) remains
            available separately as the legacy{" "}
            <code className="font-mono">/v1/decision</code> path. The execution
            gate above does not rely on multi-model arbitration today.
          </p>
        </section>

        {/* ── Footer / CTA ───────────────────────────────────────────────── */}
        <footer className="border-t border-black/10 dark:border-white/10 pt-8 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <a href="/demo" className={PRIMARY_BTN}>
              Try the structured demo
            </a>
            <a href="/api-docs" className={SECONDARY_BTN}>
              Read API docs
            </a>
          </div>
          <p className="text-xs opacity-50 leading-relaxed">
            Questions or need help testing Zorelan in your workflow? Email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="underline underline-offset-2"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
          <div className="flex gap-4 text-xs opacity-40">
            <a href="/api-docs" className="hover:opacity-100 transition-opacity">
              API Docs
            </a>
            <a href="/demo" className="hover:opacity-100 transition-opacity">
              Demo
            </a>
            <a href="/privacy" className="hover:opacity-100 transition-opacity">
              Privacy
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
