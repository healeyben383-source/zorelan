"use client";

import { useMemo, useState } from "react";

type Mode = "execution" | "strategy" | "decision";
type Context = "operator" | "general" | "student";
type AppMode = "simple" | "pro";

interface Intent {
  goal: string;
  context: string;
  constraints: string[];
  inputs_needed: string[];
}

interface Answers {
  openai: string;
  anthropic: string;
}

const MODE_LABEL: Record<Mode, string> = {
  execution: "Execution",
  strategy: "Strategy",
  decision: "Decision",
};

const CONTEXT_LABEL: Record<Context, string> = {
  operator: "Operator",
  general: "General",
  student: "Student",
};

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function buildPolishedPrompt(intent: Intent): string {
  const constraints = intent.constraints.join(". ");
  const inputs = intent.inputs_needed.map((q) => `- ${q}`).join("\n");
  return `${intent.goal}\n\nContext: ${intent.context}\n\nRequirements: ${constraints}.\n\nBefore you answer, I need you to address these questions:\n${inputs}`;
}

function renderMarkdown(text: string) {
  return text
    .split("\n")
    .map((line, i) => {
      if (line.startsWith("### ")) return <h3 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(4)}</h3>;
      if (line.startsWith("## ")) return <h2 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(3)}</h2>;
      if (line.startsWith("# ")) return <h2 key={i} className="font-semibold text-sm mt-3 mb-1">{line.slice(2)}</h2>;
      if (line.startsWith("- ") || line.startsWith("* ")) return <li key={i} className="text-sm ml-3 list-disc">{renderInline(line.slice(2))}</li>;
      if (line.trim() === "---") return <hr key={i} className="border-black/10 dark:border-white/10 my-2" />;
      if (line.trim() === "") return <div key={i} className="h-2" />;
      return <p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>;
    });
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>("simple");
  const [mode, setMode] = useState<Mode>("execution");
  const [context, setContext] = useState<Context>("operator");
  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [copied, setCopied] = useState(false);

  const canRun = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);
  const canAnalyse = useMemo(() => !!intent && !running, [intent, running]);
  const canSynthesize = useMemo(() => !!answers && !synthesizing, [answers, synthesizing]);

  async function onPreframe() {
    setCopied(false);
    setBusy(true);
    setIntent(null);
    setAnswers(null);
    setSynthesis(null);
    setError(null);
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, context, input }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) { setError(json?.error ?? "unknown_error"); return; }
      setIntent(json.data.intent);
    } finally {
      setBusy(false);
    }
  }

  async function onRunAnalysis() {
    if (!intent) return;
    setRunning(true);
    setAnswers(null);
    setSynthesis(null);
    setError(null);
    try {
      const prompt = buildPolishedPrompt(intent);
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) { setError(json?.error ?? "unknown_error"); return; }
      setAnswers(json.answers);
    } finally {
      setRunning(false);
    }
  }

  async function onSynthesize() {
    if (!intent || !answers) return;
    setSynthesizing(true);
    setSynthesis(null);
    setError(null);
    try {
      const prompt = buildPolishedPrompt(intent);
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, openai: answers.openai, anthropic: answers.anthropic }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) { setError(json?.error ?? "unknown_error"); return; }
      setSynthesis(json.synthesis);
    } finally {
      setSynthesizing(false);
    }
  }

  async function onCopy() {
    if (!intent) return;
    await navigator.clipboard.writeText(buildPolishedPrompt(intent));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function openAI(name: string) {
    if (!intent) return;
    const prompt = buildPolishedPrompt(intent);
    const encoded = encodeURIComponent(prompt);
    if (name === "ChatGPT") { await navigator.clipboard.writeText(prompt); window.open("https://chat.openai.com/", "_blank"); return; }
    if (name === "Claude") { window.open(`https://claude.ai/new?q=${encoded}`, "_blank"); return; }
    if (name === "Gemini") { window.open(`https://gemini.google.com/app?q=${encoded}`, "_blank"); return; }
    if (name === "Perplexity") { window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank"); return; }
  }

  const AI_BUTTONS = [{ name: "ChatGPT" }, { name: "Claude" }, { name: "Gemini" }, { name: "Perplexity" }];

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-3 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Zorelan</h1>
          <p className="text-sm opacity-70">Think once. Ask every AI.</p>
          <div className="inline-flex rounded-xl border border-black/10 p-1 dark:border-white/10">
            <button onClick={() => setAppMode("simple")} className={cx("rounded-lg px-4 py-1.5 text-sm font-medium transition-all", appMode === "simple" ? "bg-black text-white dark:bg-white dark:text-black" : "opacity-50 hover:opacity-80")}>Simple</button>
            <button onClick={() => setAppMode("pro")} className={cx("rounded-lg px-4 py-1.5 text-sm font-medium transition-all", appMode === "pro" ? "bg-black text-white dark:bg-white dark:text-black" : "opacity-50 hover:opacity-80")}>Pro</button>
          </div>
        </header>

        <section className="space-y-3">
          {appMode === "pro" && (
            <>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide opacity-60">Thinking Mode</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <button key={m} onClick={() => setMode(m)} className={cx("rounded-xl border px-3 py-2 text-sm", m === mode ? "border-black/40 dark:border-white/40" : "border-black/10 dark:border-white/10", m === mode ? "bg-black/5 dark:bg-white/10" : "bg-transparent")}>{MODE_LABEL[m]}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide opacity-60">Context</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                    <button key={c} onClick={() => setContext(c)} className={cx("rounded-xl border px-3 py-2 text-sm", c === context ? "border-black/40 dark:border-white/40" : "border-black/10 dark:border-white/10", c === context ? "bg-black/5 dark:bg-white/10" : "bg-transparent")}>{CONTEXT_LABEL[c]}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="What are you trying to figure out?" className="h-40 w-full rounded-2xl border border-black/10 bg-transparent p-4 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30" />

          <button onClick={onPreframe} disabled={!canRun} className={cx("w-full rounded-2xl px-4 py-3 text-sm font-medium", canRun ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50")}>
            {busy ? "Structuring…" : "Structure My Question"}
          </button>
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Something went wrong: <span className="font-mono">{error}</span>. Please try again.
          </section>
        )}

        {intent && (
          <section className="space-y-4 rounded-2xl border border-black/10 p-5 dark:border-white/10">
            {appMode === "pro" && (
              <>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">Goal</div>
                  <p className="text-sm leading-relaxed">{intent.goal}</p>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">Context</div>
                  <p className="text-sm leading-relaxed">{intent.context}</p>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">Constraints</div>
                  <ul className="space-y-1">{intent.constraints.map((c, i) => <li key={i} className="flex gap-2 text-sm"><span className="opacity-30">—</span><span>{c}</span></li>)}</ul>
                </div>
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">Inputs Needed</div>
                  <ul className="space-y-1">{intent.inputs_needed.map((q, i) => <li key={i} className="flex gap-2 text-sm"><span className="opacity-30">—</span><span>{q}</span></li>)}</ul>
                </div>
              </>
            )}

            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="text-xs uppercase tracking-wide opacity-50 mb-2">Optimized Prompt</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{buildPolishedPrompt(intent)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onCopy} className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/10">{copied ? "Copied" : "Copy Prompt"}</button>
              {AI_BUTTONS.map((a) => (
                <button key={a.name} onClick={() => openAI(a.name)} className="rounded-xl border border-black/10 px-3 py-2 text-sm opacity-80 hover:opacity-100 dark:border-white/10">
                  {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
                </button>
              ))}
            </div>

            <button onClick={onRunAnalysis} disabled={!canAnalyse} className={cx("w-full rounded-2xl px-4 py-3 text-sm font-medium", canAnalyse ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50")}>
              {running ? "Running analysis…" : "Run Analysis"}
            </button>
          </section>
        )}

        {answers && (
          <section className="space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50 text-center">AI Comparison</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-2">
                <div className="text-xs uppercase tracking-wide opacity-50">GPT-4o mini</div>
                <div>{renderMarkdown(answers.openai)}</div>
              </div>
              <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-2">
                <div className="text-xs uppercase tracking-wide opacity-50">Claude Haiku</div>
                <div>{renderMarkdown(answers.anthropic)}</div>
              </div>
            </div>

            <button onClick={onSynthesize} disabled={!canSynthesize} className={cx("w-full rounded-2xl px-4 py-3 text-sm font-medium", canSynthesize ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50")}>
              {synthesizing ? "Combining insights…" : "Combine Best Insights"}
            </button>
          </section>
        )}

        {synthesis && (
  <section className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-3">
    <div className="text-xs uppercase tracking-wide opacity-50">Combined Insight</div>
    <div>{renderMarkdown(synthesis)}</div>
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <button onClick={() => { navigator.clipboard.writeText(synthesis); }} className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/10">
        Copy Insight
      </button>
      {AI_BUTTONS.map((a) => (
        <button key={a.name} onClick={() => { const encoded = encodeURIComponent(synthesis); if (a.name === "ChatGPT") { navigator.clipboard.writeText(synthesis); window.open("https://chat.openai.com/", "_blank"); } else if (a.name === "Claude") { window.open(`https://claude.ai/new?q=${encoded}`, "_blank"); } else if (a.name === "Gemini") { window.open(`https://gemini.google.com/app?q=${encoded}`, "_blank"); } else if (a.name === "Perplexity") { window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank"); } }} className="rounded-xl border border-black/10 px-3 py-2 text-sm opacity-80 hover:opacity-100 dark:border-white/10">
          {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
        </button>
      ))}
    </div>
  </section>
)}
      </div>
    </main>
  );
}