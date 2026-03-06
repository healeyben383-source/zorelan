"use client";

import { useMemo, useState, useRef, useEffect } from "react";

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

interface HistoryEntry {
  id: string;
  timestamp: number;
  input: string;
  intent: Intent;
  userAnswers: string[];
  answers: Answers | null;
  synthesis: string | null;
}

const MODE_LABEL: Record<Mode, string> = {
  execution: "Action",
  strategy: "Strategy",
  decision: "Decision",
};

const CONTEXT_LABEL: Record<Context, string> = {
  operator: "Work",
  general: "Personal",
  student: "Study",
};

const HISTORY_KEY = "zorelan_history";
const MAX_HISTORY = 50;

function cx(...classes: Array<string | false | undefined | null>) {
  return classes.filter(Boolean).join(" ");
}

function buildPolishedPrompt(intent: Intent, userAnswers: string[]): string {
  const constraints = intent.constraints.join(". ");
  const inputs = intent.inputs_needed.map((q, i) => {
    const answer = userAnswers[i]?.trim();
    return answer ? `${q} ${answer}` : q;
  }).join("\n");
  return `${intent.goal}\n\nContext: ${intent.context}\n\nRequirements: ${constraints}.\n\nAdditional context:\n${inputs}`;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage full or unavailable
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="font-semibold text-sm mt-3 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="font-semibold text-sm mt-3 mb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h2 key={i} className="font-semibold text-sm mt-3 mb-1">{renderInline(line.slice(2))}</h2>);
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(<li key={i} className="text-sm ml-4 list-disc">{renderInline(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, "");
      elements.push(<li key={i} className="text-sm ml-4 list-decimal">{renderInline(content)}</li>);
    } else if (line.trim() === "---") {
      elements.push(<hr key={i} className="border-black/10 dark:border-white/10 my-2" />);
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>);
    }
    i++;
  }
  return elements;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline-block mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg>
  );
}

function PulsePlaceholder() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 bg-white/10 rounded w-3/4" />
      <div className="h-3 bg-white/10 rounded w-full" />
      <div className="h-3 bg-white/10 rounded w-5/6" />
      <div className="h-3 bg-white/10 rounded w-2/3" />
    </div>
  );
}

const selectedStyle = { border: "1px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.1)" };
const unselectedStyle = { border: "1px solid rgba(255,255,255,0.1)" };

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>("simple");
  const [mode, setMode] = useState<Mode>("decision");
  const [context, setContext] = useState<Context>("operator");
  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [userAnswers, setUserAnswers] = useState<string[]>(["", "", ""]);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const synthesisRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!intent) return;
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), 600);
    return () => clearTimeout(t);
  }, [userAnswers]);

  useEffect(() => {
    if (!intent || !answers) return;
    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      input,
      intent,
      userAnswers,
      answers,
      synthesis,
    };
    const updated = [entry, ...loadHistory().filter(h => h.input !== input)];
    saveHistory(updated);
    setHistory(updated);
  }, [synthesis, answers]);

  useEffect(() => {
    if (editableRef.current && editableRef.current.innerText !== input) {
      editableRef.current.innerText = input;
    }
  }, [input]);

  const canRun = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);
  const canAnalyse = useMemo(() => !!intent && !running, [intent, running]);
  const canSynthesize = useMemo(() => !!answers && !synthesizing, [answers, synthesizing]);

  const showPlaceholder = input.trim().length === 0;

  function handleEditableInput() {
    const text = editableRef.current?.innerText ?? "";
    setInput(text);
    if (intent || answers || synthesis) {
      setIntent(null);
      setAnswers(null);
      setSynthesis(null);
      setUserAnswers(["", "", ""]);
      setError(null);
    }
  }

  function loadEntry(entry: HistoryEntry) {
    setInput(entry.input);
    setIntent(entry.intent);
    setUserAnswers(entry.userAnswers);
    setAnswers(entry.answers);
    setSynthesis(entry.synthesis);
    setError(null);
    setHistoryOpen(false);
    if (editableRef.current) {
      editableRef.current.innerText = entry.input;
    }
  }

  function deleteEntry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    saveHistory(updated);
    setHistory(updated);
  }

  function clearHistory() {
    saveHistory([]);
    setHistory([]);
  }

  async function onPreframe() {
    setCopied(false);
    setBusy(true);
    setIntent(null);
    setAnswers(null);
    setSynthesis(null);
    setUserAnswers(["", "", ""]);
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
      const prompt = buildPolishedPrompt(intent, userAnswers);
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
      const prompt = buildPolishedPrompt(intent, userAnswers);
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, openai: answers.openai, anthropic: answers.anthropic }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) { setError(json?.error ?? "unknown_error"); return; }
      setSynthesis(json.synthesis);
      setTimeout(() => {
        synthesisRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } finally {
      setSynthesizing(false);
    }
  }

  async function onCopy() {
    if (!intent) return;
    await navigator.clipboard.writeText(buildPolishedPrompt(intent, userAnswers));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function openAI(name: string, text?: string) {
    const prompt = text ?? (intent ? buildPolishedPrompt(intent, userAnswers) : "");
    const encoded = encodeURIComponent(prompt);
    if (name === "ChatGPT") { await navigator.clipboard.writeText(prompt); window.open("https://chat.openai.com/", "_blank"); return; }
    if (name === "Claude") { window.open(`https://claude.ai/new?q=${encoded}`, "_blank"); return; }
    if (name === "Gemini") { window.open(`https://gemini.google.com/app?q=${encoded}`, "_blank"); return; }
    if (name === "Perplexity") { window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank"); return; }
  }

  const AI_BUTTONS = [{ name: "ChatGPT" }, { name: "Claude" }, { name: "Gemini" }, { name: "Perplexity" }];

  const SynthesizeButton = () => (
    <button onClick={onSynthesize} disabled={!canSynthesize} className={cx("w-full rounded-2xl px-4 py-3 text-sm font-medium", canSynthesize ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50")}>
      {synthesizing ? <><Spinner />Combining insights…</> : "Combine Best Insights"}
    </button>
  );

  const HistoryList = () => (
    history.length === 0 ? (
      <div className="px-5 py-8 text-center text-xs opacity-40">No history yet. Run an analysis to save it here.</div>
    ) : (
      <>
        {history.map((entry) => (
          <div
            key={entry.id}
            onClick={() => loadEntry(entry)}
            className="group flex items-start justify-between gap-2 px-5 py-3 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{entry.input}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs opacity-40">{formatTime(entry.timestamp)}</span>
                {entry.synthesis && <span className="text-xs opacity-40">· synthesized</span>}
                {entry.answers && !entry.synthesis && <span className="text-xs opacity-40">· analysed</span>}
              </div>
            </div>
            <button
              onClick={(e) => deleteEntry(entry.id, e)}
              className="opacity-0 group-hover:opacity-40 hover:!opacity-70 text-sm leading-none mt-0.5 flex-shrink-0"
            >
              ×
            </button>
          </div>
        ))}
      </>
    )
  );

  return (
    <main className="min-h-screen px-4 py-10">

      {historyOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <div className={cx(
        "fixed top-0 right-0 z-50 h-full w-80 bg-white dark:bg-black border-l border-black/10 dark:border-white/10 shadow-2xl transition-transform duration-300 hidden md:flex flex-col",
        historyOpen ? "translate-x-0" : "translate-x-full"
      )}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
          <span className="text-sm font-medium">History</span>
          <div className="flex items-center gap-3">
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-xs opacity-40 hover:opacity-70">Clear all</button>
            )}
            <button onClick={() => setHistoryOpen(false)} className="opacity-40 hover:opacity-70 text-lg leading-none">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <HistoryList />
        </div>
      </div>

      {/* Mobile drawer */}
      <div
        className={cx(
          "fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-black border-t border-black/10 dark:border-white/10 shadow-2xl transition-transform duration-300 md:hidden flex flex-col rounded-t-2xl",
          historyOpen ? "translate-y-0" : "translate-y-full"
        )}
        style={{ maxHeight: "70vh" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-black/20 dark:bg-white/20" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/10 dark:border-white/10">
          <span className="text-sm font-medium">History</span>
          <div className="flex items-center gap-3">
            {history.length > 0 && (
              <button onClick={clearHistory} className="text-xs opacity-40 hover:opacity-70">Clear all</button>
            )}
            <button onClick={() => setHistoryOpen(false)} className="opacity-40 hover:opacity-70 text-lg leading-none">×</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <HistoryList />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-3 text-center">
          <div className="flex items-center justify-between">
            <div className="w-16" />
            <h1 className="text-4xl font-semibold tracking-tight">Zorelan</h1>
            <div className="w-16 flex justify-end">
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs opacity-60 hover:opacity-100 transition-opacity"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>{history.length > 0 ? history.length : "History"}</span>
              </button>
            </div>
          </div>
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
                <div className="text-sm font-medium opacity-80">I am asking about</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                    <button key={c} onClick={() => setContext(c)} style={c === context ? selectedStyle : unselectedStyle} className="rounded-xl px-3 py-2 text-sm">
                      {CONTEXT_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium opacity-80">I need help with</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <button key={m} onClick={() => setMode(m)} style={m === mode ? selectedStyle : unselectedStyle} className="rounded-xl px-3 py-2 text-sm">
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="relative">
            {showPlaceholder && (
              <div
                className="absolute top-0 left-0 w-full p-4 text-sm pointer-events-none select-none opacity-30 leading-relaxed"
                aria-hidden="true"
              >
                <div className="mb-5">What are you trying to figure out?</div>
                <div>Type any question, decision, or problem and Zorelan will structure it and run it across multiple AI models for you.</div>
              </div>
            )}
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditableInput}
              className="min-h-40 w-full rounded-2xl border border-black/10 bg-transparent p-4 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30 leading-relaxed"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            />
          </div>

          <button onClick={onPreframe} disabled={!canRun} className={cx("w-full rounded-2xl px-4 py-3 text-sm font-medium", canRun ? "bg-black text-white dark:bg-white dark:text-black" : "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50")}>
            {busy ? <><Spinner />Structuring…</> : "Structure My Question"}
          </button>
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Something went wrong: <span className="font-mono">{error}</span>. Please try again.
          </section>
        )}

        {busy && (
          <section className="rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50">Structuring your question…</div>
            <PulsePlaceholder />
          </section>
        )}

        {intent && !busy && (
          <section className="space-y-4 rounded-2xl border border-black/10 p-5 dark:border-white/10">
            {appMode === "pro" && (
              <>
                <div className="text-xs uppercase tracking-wide opacity-50">How we structured it</div>
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
                <hr className="border-white/10" />
              </>
            )}

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide opacity-50">Answer these to get better results <span className="opacity-50 normal-case">(optional)</span></div>
              {intent.inputs_needed.map((question, i) => (
                <div key={i} className="space-y-1">
                  <label className="text-xs opacity-60">{question}</label>
                  <input
                    type="text"
                    value={userAnswers[i] ?? ""}
                    onChange={(e) => {
                      const updated = [...userAnswers];
                      updated[i] = e.target.value;
                      setUserAnswers(updated);
                    }}
                    placeholder="Your answer…"
                    className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
                  />
                </div>
              ))}
            </div>

            <div className={cx(
              "rounded-xl border p-4 transition-all duration-500",
              highlighted
                ? "border-blue-400/60 bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-400/10"
                : "border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]"
            )}>
              <div className="text-xs uppercase tracking-wide opacity-50 mb-2">Ready to use</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{buildPolishedPrompt(intent, userAnswers)}</p>
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
              {running ? <><Spinner />Running analysis…</> : "Run Analysis"}
            </button>
            {!running && !answers && (
              <p className="text-xs text-center opacity-60 mt-1">This usually takes 15–20 seconds</p>
            )}
          </section>
        )}

        {running && (
          <section className="space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50 text-center">Querying AI models…</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 p-5 space-y-3">
                <div className="text-xs uppercase tracking-wide opacity-50">GPT-4o mini</div>
                <PulsePlaceholder />
              </div>
              <div className="rounded-2xl border border-white/10 p-5 space-y-3">
                <div className="text-xs uppercase tracking-wide opacity-50">Claude Haiku</div>
                <PulsePlaceholder />
              </div>
            </div>
          </section>
        )}

        {answers && !running && (
          <section className="space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50 text-center">AI Comparison</div>
            <div className="md:hidden">
              <SynthesizeButton />
            </div>
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
            <div className="hidden md:block">
              <SynthesizeButton />
            </div>
          </section>
        )}

        {synthesizing && (
          <section className="rounded-2xl border border-white/10 p-5 space-y-3">
            <div className="text-xs uppercase tracking-wide opacity-50">Combining insights…</div>
            <PulsePlaceholder />
          </section>
        )}

        {synthesis && !synthesizing && (
          <section ref={synthesisRef} className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-3">
            <div className="text-xs uppercase tracking-wide opacity-50">Combined Insight</div>
            <div>{renderMarkdown(synthesis)}</div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button onClick={() => navigator.clipboard.writeText(synthesis)} className="rounded-xl border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                Copy Insight
              </button>
              {AI_BUTTONS.map((a) => (
                <button key={a.name} onClick={() => openAI(a.name, synthesis)} className="rounded-xl border border-black/10 px-3 py-2 text-sm opacity-80 hover:opacity-100 dark:border-white/10">
                  {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="text-center pt-6">
          <a href="/privacy" className="text-xs opacity-30 hover:opacity-60 transition-opacity">Privacy Policy</a>
        </div>

      </div>
    </main>
  );
}