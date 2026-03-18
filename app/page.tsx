"use client";

import { useMemo, useState, useRef, useEffect } from "react";

type Mode = "execution" | "strategy" | "decision";
type Context = "operator" | "general" | "student";
type AppMode = "simple" | "pro";
type ProviderName = "openai" | "anthropic" | "perplexity";
type DisagreementType =
  | "none"
  | "additive_nuance"
  | "explanation_variation"
  | "conditional_alignment"
  | "material_conflict";

interface Intent {
  goal: string;
  context: string;
  constraints: string[];
  inputs_needed: string[];
}

interface Answers {
  openai: string;
  anthropic: string;
  perplexity: string;
}

interface StructuredSynthesis {
  finalAnswer: string;
  sharedConclusion: string;
  keyDifference: string;
  decisionRule: string;
}

interface DecisionVerification {
  verdict: string;
  consensus: {
    level: "high" | "medium" | "low";
    modelsAligned: number;
  };
  riskLevel: "low" | "moderate" | "high";
  keyDisagreement: string;
  recommendedAction: string;
  finalConclusionAligned?: boolean;
  disagreementType?: DisagreementType;
}

interface TrustScore {
  score: number;
  label: "high" | "moderate" | "low";
  reason: string;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  input: string;
  intent: Intent;
  userAnswers: string[];
  answers: Answers | null;
  selectedProviders?: ProviderName[];
  synthesis: string | null;
  structuredSynthesis?: StructuredSynthesis | null;
  comparison?: {
    agreementLevel: "high" | "medium" | "low";
    likelyConflict: boolean;
    overlapRatio?: number;
    summary: string;
    finalConclusionAligned?: boolean;
    disagreementType?: DisagreementType;
  } | null;
  decisionVerification?: DecisionVerification | null;
  trustScore?: TrustScore | null;
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
  const inputs = intent.inputs_needed
    .map((q, i) => {
      const answer = userAnswers[i]?.trim();
      return answer ? `${q} ${answer}` : q;
    })
    .join("\n");

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
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(entries.slice(0, MAX_HISTORY))
    );
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

    if (line.startsWith("#### ")) {
      elements.push(
        <h4 key={i} className="font-semibold text-sm mt-2 mb-1">
          {renderInline(line.slice(5))}
        </h4>
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} className="font-semibold text-sm mt-3 mb-1">
          {renderInline(line.slice(4))}
        </h3>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} className="font-semibold text-sm mt-3 mb-1">
          {renderInline(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h2 key={i} className="font-semibold text-sm mt-3 mb-1">
          {renderInline(line.slice(2))}
        </h2>
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={i} className="text-sm ml-4 list-disc">
          {renderInline(line.slice(2))}
        </li>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, "");
      elements.push(
        <li key={i} className="text-sm ml-4 list-decimal">
          {renderInline(content)}
        </li>
      );
    } else if (line.trim() === "---") {
      elements.push(
        <hr key={i} className="border-black/10 dark:border-white/10 my-2" />
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
    } else {
      elements.push(
        <p
          key={i}
          className="text-sm leading-relaxed whitespace-pre-wrap break-words"
        >
          {renderInline(line)}
        </p>
      );
    }

    i++;
  }

  return elements;
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);

  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

function getProviderLabel(provider: ProviderName) {
  switch (provider) {
    case "openai":
      return "GPT-4o mini";
    case "anthropic":
      return "Claude Sonnet";
    case "perplexity":
      return "Perplexity Sonar";
    default:
      return provider;
  }
}

function getConfidenceBadgeClasses(level: "high" | "medium" | "low") {
  if (level === "high") return "bg-green-500/10 text-green-500";
  if (level === "medium") return "bg-yellow-500/10 text-yellow-500";
  return "bg-red-500/10 text-red-500";
}

function getConfidenceLabel(level: "high" | "medium" | "low") {
  if (level === "high") return "High Confidence";
  if (level === "medium") return "Medium Confidence";
  return "Low Confidence";
}

function getRiskBadgeClasses(level: "low" | "moderate" | "high") {
  if (level === "low") return "bg-green-500/10 text-green-500";
  if (level === "moderate") return "bg-yellow-500/10 text-yellow-500";
  return "bg-red-500/10 text-red-500";
}

function getTrustBadgeClasses(label: "high" | "moderate" | "low") {
  if (label === "high") return "bg-green-500/10 text-green-500";
  if (label === "moderate") return "bg-yellow-500/10 text-yellow-500";
  return "bg-red-500/10 text-red-500";
}

function getTrustLabel(label: "high" | "moderate" | "low") {
  if (label === "high") return "Strong";
  if (label === "moderate") return "Use With Caution";
  return "Needs Review";
}

function getDisagreementLabel(
  disagreementType?: DisagreementType,
  likelyConflict?: boolean
) {
  if (disagreementType === "none") return "None";
  if (disagreementType === "additive_nuance") return "Minor";
  if (disagreementType === "explanation_variation") return "Minor";
  if (disagreementType === "conditional_alignment") return "Conditional";
  if (disagreementType === "material_conflict") return "Present";
  return likelyConflict ? "Present" : "Limited";
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 inline-block mr-2"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8z"
      />
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

function InsightBlock({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  if (!value?.trim()) return null;

  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10 space-y-1">
      <div className="text-xs uppercase tracking-wide opacity-50">{title}</div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {value}
      </div>
    </div>
  );
}

function CopyIconButton({
  copied,
  onClick,
  label,
}: {
  copied: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={copied ? "Copied" : label}
      className="inline-flex h-11 w-11 md:h-auto md:w-auto items-center justify-center rounded-xl border border-black/10 dark:border-white/10 px-2.5 py-2 text-xs opacity-75 hover:opacity-100 active:scale-[0.98] transition-all"
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const selectedStyle = {
  border: "1px solid rgba(255,255,255,0.55)",
  background: "rgba(255,255,255,0.12)",
};

const unselectedStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
};

function ProviderAnswerCard({
  provider,
  answer,
}: {
  provider: ProviderName;
  answer: string;
}) {
  return (
    <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-2 min-w-0 overflow-hidden">
      <div className="space-y-0.5">
        <div className="text-xs uppercase tracking-wide opacity-50">
          {getProviderLabel(provider)}
        </div>
        <div className="text-[11px] uppercase tracking-wide opacity-35">
          Selected by Zorelan
        </div>
      </div>

      <div className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden [&_*]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
        {renderMarkdown(answer || "No response returned.")}
      </div>
    </div>
  );
}

function LoadingProviderCard() {
  return (
    <div className="rounded-2xl border border-white/10 p-5 space-y-3">
      <div className="space-y-0.5">
        <div className="text-xs uppercase tracking-wide opacity-50">
          Selecting AI models…
        </div>
        <div className="text-[11px] uppercase tracking-wide opacity-35">
          Zorelan is routing the best providers for this task
        </div>
      </div>
      <PulsePlaceholder />
    </div>
  );
}

function PrimaryActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full rounded-2xl px-4 py-3.5 md:py-3 text-base md:text-sm font-medium transition-all active:scale-[0.99]",
        disabled
          ? "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50"
          : "bg-white text-black shadow-sm hover:shadow-md dark:bg-white dark:text-black"
      )}
    >
      {children}
    </button>
  );
}

function SecondaryActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full rounded-2xl px-4 py-3.5 md:py-3 text-base md:text-sm font-medium transition-all active:scale-[0.99]",
        disabled
          ? "bg-black/20 text-black/50 dark:bg-white/20 dark:text-white/50"
          : "bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
      )}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  selected,
  children,
  onClick,
}: {
  selected: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={selected ? selectedStyle : unselectedStyle}
      className={cx(
        "rounded-xl px-3 py-3 md:py-2 text-base md:text-sm transition-all active:scale-[0.98]",
        selected ? "shadow-sm" : "opacity-90 hover:opacity-100"
      )}
    >
      {children}
    </button>
  );
}

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>("simple");
  const [mode, setMode] = useState<Mode>("decision");
  const [context, setContext] = useState<Context>("operator");
  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [userAnswers, setUserAnswers] = useState<string[]>(["", "", ""]);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<ProviderName[]>([]);
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [structuredSynthesis, setStructuredSynthesis] =
    useState<StructuredSynthesis | null>(null);
  const [comparison, setComparison] = useState<{
    agreementLevel: "high" | "medium" | "low";
    likelyConflict: boolean;
    overlapRatio?: number;
    summary: string;
    finalConclusionAligned?: boolean;
    disagreementType?: DisagreementType;
  } | null>(null);
  const [decisionVerification, setDecisionVerification] =
    useState<DecisionVerification | null>(null);
  const [trustScore, setTrustScore] = useState<TrustScore | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [insightCopied, setInsightCopied] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const synthesisRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!intent) return;
    setHighlighted(true);
    const t = setTimeout(() => setHighlighted(false), 600);
    return () => clearTimeout(t);
  }, [userAnswers, intent]);

  useEffect(() => {
    if (!intent || !answers) return;

    const entry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      input,
      intent,
      userAnswers,
      answers,
      selectedProviders,
      synthesis,
      structuredSynthesis,
      comparison,
      decisionVerification,
      trustScore,
    };

    const updated = [entry, ...loadHistory().filter((h) => h.input !== input)];
    saveHistory(updated);
    setHistory(updated);
  }, [
    synthesis,
    structuredSynthesis,
    answers,
    selectedProviders,
    input,
    intent,
    userAnswers,
    comparison,
    decisionVerification,
    trustScore,
  ]);

  useEffect(() => {
    if (editableRef.current && editableRef.current.innerText !== input) {
      editableRef.current.innerText = input;
    }
  }, [input]);

  const canRun = useMemo(() => input.trim().length > 0 && !busy, [input, busy]);
  const canAnalyse = useMemo(() => !!intent && !running, [intent, running]);
  const canSynthesize = useMemo(
    () => !!answers && selectedProviders.length === 2 && !synthesizing,
    [answers, selectedProviders, synthesizing]
  );

  const showPlaceholder = input.trim().length === 0;

  function resetAnalysisState() {
    setIntent(null);
    setAnswers(null);
    setSelectedProviders([]);
    setSynthesis(null);
    setStructuredSynthesis(null);
    setComparison(null);
    setDecisionVerification(null);
    setTrustScore(null);
    setCached(false);
    setUserAnswers(["", "", ""]);
    setError(null);
    setPromptCopied(false);
    setInsightCopied(false);
  }

  function handleEditableInput() {
    const text = editableRef.current?.innerText ?? "";
    setInput(text);

    if (
      intent ||
      answers ||
      synthesis ||
      structuredSynthesis ||
      comparison ||
      trustScore
    ) {
      resetAnalysisState();
    }
  }

  function loadEntry(entry: HistoryEntry) {
    setInput(entry.input);
    setIntent(entry.intent);
    setUserAnswers(entry.userAnswers);
    setAnswers(entry.answers);
    setSelectedProviders(entry.selectedProviders ?? ["openai", "anthropic"]);
    setSynthesis(entry.synthesis);
    setStructuredSynthesis(entry.structuredSynthesis ?? null);
    setComparison(entry.comparison ?? null);
    setDecisionVerification(entry.decisionVerification ?? null);
    setTrustScore(entry.trustScore ?? null);
    setCached(false);
    setError(null);
    setHistoryOpen(false);
    setPromptCopied(false);
    setInsightCopied(false);

    if (editableRef.current) {
      editableRef.current.innerText = entry.input;
    }
  }

  function deleteEntry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    const updated = history.filter((h) => h.id !== id);
    saveHistory(updated);
    setHistory(updated);
  }

  function clearHistory() {
    saveHistory([]);
    setHistory([]);
  }

  async function onPreframe() {
    setPromptCopied(false);
    setInsightCopied(false);
    setBusy(true);
    resetAnalysisState();

    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, context, input }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setError(json?.error ?? "unknown_error");
        return;
      }

      setIntent(json.data.intent);
    } finally {
      setBusy(false);
    }
  }

  async function onRunAnalysis() {
    if (!intent) return;

    setRunning(true);
    setAnswers(null);
    setSelectedProviders([]);
    setSynthesis(null);
    setStructuredSynthesis(null);
    setComparison(null);
    setDecisionVerification(null);
    setTrustScore(null);
    setInsightCopied(false);
    setError(null);

    try {
      const prompt = buildPolishedPrompt(intent, userAnswers);

      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setError(json?.error ?? "unknown_error");
        return;
      }

      setAnswers(json.answers);
      setSelectedProviders((json.selectedProviders ?? []).slice(0, 2));
      setComparison(json.comparison ?? null);
      setDecisionVerification(json.decisionVerification ?? null);
      setTrustScore(json.trustScore ?? null);
      setCached(json.cached ?? false);

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } finally {
      setRunning(false);
    }
  }

  async function onSynthesize() {
    if (!intent || !answers || selectedProviders.length !== 2) return;

    setSynthesizing(true);
    setSynthesis(null);
    setStructuredSynthesis(null);
    setInsightCopied(false);
    setError(null);

    try {
      const prompt = buildPolishedPrompt(intent, userAnswers);

      const providerPayload = {
        openai: answers.openai,
        anthropic: answers.anthropic,
        perplexity: answers.perplexity,
      };

      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          selectedProviders,
          answers: providerPayload,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!json?.ok) {
        setError(json?.error ?? "unknown_error");
        return;
      }

      setSynthesis(json.synthesis);
      setStructuredSynthesis(json.structuredSynthesis ?? null);
      setComparison(json.comparison ?? null);
      setDecisionVerification(json.decisionVerification ?? null);
      setTrustScore(json.trustScore ?? null);

      setTimeout(() => {
        synthesisRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    } finally {
      setSynthesizing(false);
    }
  }

  async function onCopyPrompt() {
    if (!intent) return;
    await navigator.clipboard.writeText(buildPolishedPrompt(intent, userAnswers));
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1200);
  }

  async function onCopyInsight() {
    if (!synthesis) return;
    await navigator.clipboard.writeText(synthesis);
    setInsightCopied(true);
    setTimeout(() => setInsightCopied(false), 1200);
  }

  async function openAI(name: string, text?: string) {
    const prompt = text ?? (intent ? buildPolishedPrompt(intent, userAnswers) : "");
    const encoded = encodeURIComponent(prompt);

    if (name === "ChatGPT") {
      await navigator.clipboard.writeText(prompt);
      window.open("https://chat.openai.com/", "_blank");
      return;
    }

    if (name === "Claude") {
      window.open(`https://claude.ai/new?q=${encoded}`, "_blank");
      return;
    }

    if (name === "Gemini") {
      window.open(`https://gemini.google.com/app?q=${encoded}`, "_blank");
      return;
    }

    if (name === "Perplexity") {
      window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank");
      return;
    }
  }

  const AI_BUTTONS = [
    { name: "ChatGPT" },
    { name: "Claude" },
    { name: "Gemini" },
    { name: "Perplexity" },
  ];

  const comparisonProviders: ProviderName[] =
    selectedProviders.length === 2
      ? selectedProviders
      : ["openai", "anthropic"];

  const SynthesizeButton = () => (
    <SecondaryActionButton
      onClick={onSynthesize}
      disabled={!canSynthesize}
    >
      {synthesizing ? (
        <>
          <Spinner />
          Combining insights…
        </>
      ) : (
        "Combine Best Insights"
      )}
    </SecondaryActionButton>
  );

  const HistoryList = () =>
    history.length === 0 ? (
      <div className="px-5 py-8 text-center text-xs opacity-40">
        No history yet. Run an analysis to save it here.
      </div>
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
                <span className="text-xs opacity-40">
                  {formatTime(entry.timestamp)}
                </span>
                {entry.synthesis && (
                  <span className="text-xs opacity-40">· synthesized</span>
                )}
                {entry.answers && !entry.synthesis && (
                  <span className="text-xs opacity-40">· analysed</span>
                )}
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
    );

  const displayedConfidenceLevel: "high" | "medium" | "low" =
    decisionVerification?.consensus.level ??
    comparison?.agreementLevel ??
    "medium";

  const displayedConsensusLevel: "high" | "medium" | "low" =
    decisionVerification?.consensus.level ??
    comparison?.agreementLevel ??
    "medium";

  const displayedDisagreementLabel = getDisagreementLabel(
    decisionVerification?.disagreementType ?? comparison?.disagreementType,
    comparison?.likelyConflict
  );

  return (
    <main className="min-h-screen px-4 py-10">
      {historyOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      <div
        className={cx(
          "fixed top-0 right-0 z-50 h-full w-80 bg-white dark:bg-black border-l border-black/10 dark:border-white/10 shadow-2xl transition-transform duration-300 hidden md:flex flex-col",
          historyOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
          <span className="text-sm font-medium">History</span>
          <div className="flex items-center gap-3">
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs opacity-40 hover:opacity-70"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setHistoryOpen(false)}
              className="opacity-40 hover:opacity-70 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <HistoryList />
        </div>
      </div>

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
              <button
                onClick={clearHistory}
                className="text-xs opacity-40 hover:opacity-70"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setHistoryOpen(false)}
              className="opacity-40 hover:opacity-70 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <HistoryList />
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-4 text-center">
          <div className="flex items-center justify-between">
            <div className="w-16" />
            <h1 className="text-4xl font-semibold tracking-tight">Zorelan</h1>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex h-11 md:h-auto items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm md:text-xs opacity-70 hover:opacity-100 active:scale-[0.98] transition-all"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{history.length > 0 ? history.length : "History"}</span>
              </button>
              <a
                href="/api-docs"
                className="flex h-11 md:h-auto items-center rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm md:text-xs opacity-70 hover:opacity-100 active:scale-[0.98] transition-all"
              >
                API
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm opacity-70">Verify AI before you trust it.</p>
            <p className="mx-auto max-w-2xl text-sm opacity-50 leading-relaxed">
              Zorelan compares multiple models and returns a verified answer
              with calibrated trust — not just agreement.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 text-xs opacity-45">
            <span>Consensus</span>
            <span>•</span>
            <span>Risk</span>
            <span>•</span>
            <span>Trust Score</span>
          </div>

          <div className="inline-flex rounded-xl border border-black/10 p-1 dark:border-white/10">
            <button
              onClick={() => setAppMode("simple")}
              className={cx(
                "rounded-lg px-5 py-2.5 md:px-4 md:py-1.5 text-base md:text-sm font-medium transition-all active:scale-[0.98]",
                appMode === "simple"
                  ? "bg-white text-black shadow-sm dark:bg-white dark:text-black"
                  : "opacity-60 hover:opacity-90"
              )}
            >
              Simple
            </button>
            <button
              onClick={() => setAppMode("pro")}
              className={cx(
                "rounded-lg px-5 py-2.5 md:px-4 md:py-1.5 text-base md:text-sm font-medium transition-all active:scale-[0.98]",
                appMode === "pro"
                  ? "bg-white text-black shadow-sm dark:bg-white dark:text-black"
                  : "opacity-60 hover:opacity-90"
              )}
            >
              Pro
            </button>
          </div>
        </header>

        <section className="space-y-4">
          {appMode === "pro" && (
            <>
              <div className="space-y-4">
                <div className="text-lg md:text-base font-medium opacity-90">
                  I am asking about
                </div>
                <div className="grid grid-cols-3 gap-3 md:gap-2">
                  {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                    <ToggleButton
                      key={c}
                      selected={c === context}
                      onClick={() => setContext(c)}
                    >
                      {CONTEXT_LABEL[c]}
                    </ToggleButton>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-lg md:text-base font-medium opacity-90">
                  I need help with
                </div>
                <div className="grid grid-cols-3 gap-3 md:gap-2">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <ToggleButton
                      key={m}
                      selected={m === mode}
                      onClick={() => setMode(m)}
                    >
                      {MODE_LABEL[m]}
                    </ToggleButton>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="relative">
            {showPlaceholder && (
              <div
                className="absolute top-0 left-0 w-full p-4 text-base md:text-sm pointer-events-none select-none opacity-30 leading-relaxed"
                aria-hidden="true"
              >
                <div className="mb-5">What are you trying to figure out?</div>
                <div>
                  Type any question, decision, or problem and Zorelan will
                  structure it, verify it across multiple models, and return a
                  trust-aware answer.
                </div>
              </div>
            )}

            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleEditableInput}
              className="min-h-40 w-full rounded-2xl border border-black/10 bg-transparent p-4 text-base md:text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30 leading-relaxed"
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            />
          </div>

          <PrimaryActionButton onClick={onPreframe} disabled={!canRun}>
            {busy ? (
              <>
                <Spinner />
                Structuring…
              </>
            ) : (
              "Structure My Question"
            )}
          </PrimaryActionButton>
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Something went wrong: <span className="font-mono">{error}</span>.
            Please try again.
          </section>
        )}

        {busy && (
          <section className="rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50">
              Structuring your question…
            </div>
            <PulsePlaceholder />
          </section>
        )}

        {intent && !busy && (
          <section className="space-y-4 rounded-2xl border border-black/10 p-5 dark:border-white/10">
            {appMode === "pro" && (
              <>
                <div className="text-xs uppercase tracking-wide opacity-50">
                  How we structured it
                </div>

                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">
                    Goal
                  </div>
                  <p className="text-sm leading-relaxed">{intent.goal}</p>
                </div>

                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">
                    Context
                  </div>
                  <p className="text-sm leading-relaxed">{intent.context}</p>
                </div>

                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wide opacity-50">
                    Constraints
                  </div>
                  <ul className="space-y-1">
                    {intent.constraints.map((c, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="opacity-30">—</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <hr className="border-white/10" />
              </>
            )}

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wide opacity-50">
                Answer these to get better results{" "}
                <span className="opacity-50 normal-case">(optional)</span>
              </div>

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
                    className="w-full rounded-xl border border-black/10 bg-transparent px-3 py-2.5 text-base md:text-sm outline-none focus:border-black/30 dark:border-white/10 dark:focus:border-white/30"
                  />
                </div>
              ))}
            </div>

            <div
              className={cx(
                "relative rounded-xl border p-4 pr-16 transition-all duration-500",
                highlighted
                  ? "border-blue-400/60 bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-400/10"
                  : "border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]"
              )}
            >
              <div className="absolute top-3 right-3">
                <CopyIconButton
                  copied={promptCopied}
                  onClick={onCopyPrompt}
                  label="Copy prompt"
                />
              </div>

              <div className="text-xs uppercase tracking-wide opacity-50 mb-2">
                Ready to use
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {buildPolishedPrompt(intent, userAnswers)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center md:gap-2">
              {AI_BUTTONS.map((a) => (
                <button
                  key={a.name}
                  onClick={() => openAI(a.name)}
                  className="rounded-xl border border-black/10 px-3 py-3 md:py-2 text-base md:text-sm opacity-85 hover:opacity-100 active:scale-[0.98] dark:border-white/10 transition-all"
                >
                  {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
                </button>
              ))}
            </div>

            <PrimaryActionButton
              onClick={onRunAnalysis}
              disabled={!canAnalyse}
            >
              {running ? (
                <>
                  <Spinner />
                  Running analysis…
                </>
              ) : (
                "Run Analysis"
              )}
            </PrimaryActionButton>

            {!running && !answers && (
              <p className="text-xs text-center opacity-60 mt-1">
                This usually takes 15–20 seconds
              </p>
            )}
          </section>
        )}

        {running && (
          <section className="space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50 text-center">
              Querying AI models…
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <LoadingProviderCard />
              <LoadingProviderCard />
            </div>
          </section>
        )}

        {answers && !running && (
          <section ref={resultsRef} className="space-y-4">
            {(trustScore || decisionVerification) && (
              <div className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Analysis Summary
                    </div>
                    {cached && (
                      <div className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/40">
                        ⚡ Cached result · verified earlier
                      </div>
                    )}
                  </div>
                  <div
                    className={cx(
                      "text-xs font-medium px-3 py-1 rounded-full",
                      getConfidenceBadgeClasses(displayedConfidenceLevel)
                    )}
                  >
                    {getConfidenceLabel(displayedConfidenceLevel)}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Trust Score
                    </div>
                    <div className="text-2xl font-semibold leading-none">
                      {trustScore?.score ?? "—"}
                      <span className="text-sm font-normal opacity-40">/100</span>
                    </div>
                    {trustScore && (
                      <div
                        className={cx(
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                          getTrustBadgeClasses(trustScore.label)
                        )}
                      >
                        {getTrustLabel(trustScore.label)}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Consensus
                    </div>
                    <div className="text-sm font-medium capitalize">
                      {displayedConsensusLevel}
                    </div>
                    <div
                      className={cx(
                        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium",
                        getConfidenceBadgeClasses(displayedConsensusLevel)
                      )}
                    >
                      {decisionVerification?.consensus.modelsAligned ?? 0}/2 aligned
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Risk
                    </div>
                    <div className="text-sm font-medium capitalize">
                      {decisionVerification?.riskLevel ?? "—"}
                    </div>
                    {decisionVerification?.riskLevel && (
                      <div
                        className={cx(
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize",
                          getRiskBadgeClasses(decisionVerification.riskLevel)
                        )}
                      >
                        {decisionVerification.riskLevel}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Model Disagreement
                    </div>
                    <div className="text-sm font-medium">
                      {displayedDisagreementLabel}
                    </div>
                  </div>
                </div>

                {trustScore?.reason && (
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
                    <div className="text-xs uppercase tracking-wide opacity-50 mb-2">
                      Why this score
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {trustScore.reason}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="text-xs uppercase tracking-wide opacity-50 text-center">
              AI Comparison
            </div>

            <div className="md:hidden">
              <SynthesizeButton />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {comparisonProviders.map((provider) => (
                <ProviderAnswerCard
                  key={provider}
                  provider={provider}
                  answer={answers[provider] || "No response returned."}
                />
              ))}
            </div>

            <div className="hidden md:block">
              <SynthesizeButton />
            </div>
          </section>
        )}

        {synthesizing && (
          <section className="rounded-2xl border border-white/10 p-5 space-y-3">
            <div className="text-xs uppercase tracking-wide opacity-50">
              Combining insights…
            </div>
            <PulsePlaceholder />
          </section>
        )}

        {synthesis && !synthesizing && (
          <section
            ref={synthesisRef}
            className="rounded-2xl border border-black/10 p-5 dark:border-white/10 space-y-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs uppercase tracking-wide opacity-50">
                Verified Decision
              </div>
              {(comparison || decisionVerification) && (
                <div
                  className={cx(
                    "text-xs font-medium px-3 py-1 rounded-full",
                    getConfidenceBadgeClasses(displayedConfidenceLevel)
                  )}
                >
                  {getConfidenceLabel(displayedConfidenceLevel)}
                </div>
              )}
            </div>

            {trustScore && (
              <div className="rounded-xl border border-black/10 dark:border-white/10 p-5 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Trust Score
                </div>

                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex items-end gap-1.5">
                      <div className="text-6xl md:text-7xl font-semibold tracking-tight leading-none">
                        {trustScore.score}
                      </div>
                      <div className="text-base md:text-lg opacity-40 pb-1.5">
                        /100
                      </div>
                    </div>

                    <div
                      className={cx(
                        "inline-flex rounded-full px-3 py-1 text-xs font-medium",
                        getTrustBadgeClasses(trustScore.label)
                      )}
                    >
                      {getTrustLabel(trustScore.label)}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-[360px]">
                    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                      <div className="text-xs uppercase tracking-wide opacity-50">
                        Confidence
                      </div>
                      <div className="text-sm font-medium">
                        {getConfidenceLabel(displayedConfidenceLevel)}
                      </div>
                    </div>

                    <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                      <div className="text-xs uppercase tracking-wide opacity-50">
                        Risk
                      </div>
                      <div className="text-sm font-medium capitalize">
                        {decisionVerification?.riskLevel ?? "—"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 dark:border-white/10 p-4">
                  <div className="text-xs uppercase tracking-wide opacity-50 mb-2">
                    Why this score
                  </div>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {trustScore.reason}
                  </div>
                </div>
              </div>
            )}

            {decisionVerification && (
              <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Verification Summary
                </div>

                <InsightBlock
                  title="Decision Verdict"
                  value={decisionVerification.verdict}
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InsightBlock
                    title="Recommended Action"
                    value={decisionVerification.recommendedAction}
                  />
                  <InsightBlock
                    title="Key Disagreement"
                    value={decisionVerification.keyDisagreement}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Consensus
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium capitalize">
                        {displayedConsensusLevel}
                      </div>
                      <div
                        className={cx(
                          "text-xs font-medium px-2.5 py-1 rounded-full",
                          getConfidenceBadgeClasses(displayedConsensusLevel)
                        )}
                      >
                        {decisionVerification.consensus.modelsAligned}/2 aligned
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Risk Level
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium capitalize">
                        {decisionVerification.riskLevel}
                      </div>
                      <div
                        className={cx(
                          "text-xs font-medium px-2.5 py-1 rounded-full capitalize",
                          getRiskBadgeClasses(decisionVerification.riskLevel)
                        )}
                      >
                        {decisionVerification.riskLevel}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-black/10 dark:border-white/10 p-4 space-y-1">
                    <div className="text-xs uppercase tracking-wide opacity-50">
                      Model Disagreement
                    </div>
                    <div className="text-sm font-medium">
                      {displayedDisagreementLabel}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="relative space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-4 pr-16 overflow-hidden">
              <div className="absolute top-3 right-3">
                <CopyIconButton
                  copied={insightCopied}
                  onClick={onCopyInsight}
                  label="Copy insight"
                />
              </div>

              <div className="text-xs uppercase tracking-wide opacity-50">
                Explanation
              </div>
              <div className="min-w-0 max-w-full overflow-x-auto [&_*]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
                {renderMarkdown(synthesis)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center md:gap-2">
              {AI_BUTTONS.map((a) => (
                <button
                  key={a.name}
                  onClick={() => openAI(a.name, synthesis)}
                  className="rounded-xl border border-black/10 px-3 py-3 md:py-2 text-base md:text-sm opacity-85 hover:opacity-100 active:scale-[0.98] dark:border-white/10 transition-all"
                >
                  {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
                </button>
              ))}
            </div>

            {structuredSynthesis && (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Key Takeaways
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <InsightBlock
                    title="Final Answer"
                    value={structuredSynthesis.finalAnswer}
                  />
                  <InsightBlock
                    title="Shared Conclusion"
                    value={structuredSynthesis.sharedConclusion}
                  />
                  <InsightBlock
                    title="Key Difference"
                    value={structuredSynthesis.keyDifference}
                  />
                  <InsightBlock
                    title="Decision Rule"
                    value={structuredSynthesis.decisionRule}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        <div className="text-center pt-6">
          <a
            href="/privacy"
            className="text-xs opacity-30 hover:opacity-60 transition-opacity"
          >
            Privacy Policy
          </a>
        </div>
      </div>
    </main>
  );
}