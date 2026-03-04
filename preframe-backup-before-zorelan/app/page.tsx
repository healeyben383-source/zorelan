"use client";

import { useMemo, useState } from "react";

type Mode = "execution" | "strategy" | "decision";
type Context = "operator" | "general" | "student";

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

const AI_LINKS = [
  { name: "ChatGPT", href: "https://chat.openai.com/" },
  { name: "Claude", href: "https://claude.ai/" },
  { name: "Gemini", href: "https://gemini.google.com/" },
  { name: "Perplexity", href: "https://www.perplexity.ai/" },
];

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("execution");
  const [context, setContext] = useState<Context>("operator");
  const [input, setInput] = useState("");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const canRun = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);

  async function onPreframe() {
    setCopied(false);
    setBusy(true);
    setOut("");

    await new Promise((r) => setTimeout(r, 500));

    const res = await fetch("/api/preframe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, context, input }),
    });

    const json = await res.json().catch(() => null);
    setBusy(false);

    if (!json?.ok) {
      setOut(
        `### Reframed Question\n\n(Preframe error: ${json?.error ?? "unknown"})\n\n### Optimized Prompt\n\nTry again.`
      );
      return;
    }

    setOut(json.text ?? "");
  }

  async function onCopy() {
    if (!out) return;
    const idx = out.indexOf("### Optimized Prompt");
    const copyText = idx >= 0 ? out.slice(idx).trim() : out.trim();
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Preframe</h1>
          <p className="text-sm opacity-70">The layer before AI.</p>
        </header>

        <section className="space-y-3">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide opacity-60">Thinking Mode</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cx(
                    "rounded-xl border px-3 py-2 text-sm",
                    m === mode
                      ? "border-black/40 dark:border-white/40"
                      : "border-black/10 dark:border-white/10",
                    m === mode ? "bg-black/5 dark:bg-white/10" : "bg-transparent"
                  )}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide opacity-60">Context</div>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                <button
                  key={c}
                  onClick={() => setContext(c)}
                  className={cx(
                    "rounded-xl border px-3 py-2 text-sm",
                    c === context
                      ? "border-black/40 dark:border-white/40"
                      : "border-black/10 dark:border-white/10",
                    c === context ? "bg-black/5 dark:bg-white/10" : "bg-transparent"
                  )}
                >
                  {CONTEXT_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your rough question. Don’t overthink it."
            className="h-40 w-full rounded-2xl border border-black/10 bg-transparent p-4 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
          />

          <button
            onClick={onPreframe}
            disabled={!canRun}
            className={cx(
              "w-full rounded-2xl px-4 py-3 text-sm font-medium",
              canRun
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50"
            )}
          >
            {busy ? "Preframing…" : "Preframe"}
          </button>

          <div className="text-center text-xs opacity-60">Run it through Preframe first.</div>
        </section>

        {out && (
          <section className="space-y-3 rounded-2xl border border-black/10 p-4 dark:border-white/10">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed">{out}</pre>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={onCopy}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/10"
              >
                {copied ? "Copied" : "Copy Optimized Prompt"}
              </button>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {AI_LINKS.map((a) => (
                  <a
                    key={a.name}
                    href={a.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm opacity-80 hover:opacity-100 dark:border-white/10"
                  >
                    {a.name}
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}