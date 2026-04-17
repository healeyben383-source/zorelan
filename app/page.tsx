"use client";

import {
  useMemo,
  useState,
  useRef,
  useEffect,
  type ReactNode,
  type MouseEvent,
} from "react";

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
  decision: "allow" | "review" | "block";
  decision_reason: string;
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

type StreamEvent =
  | {
      type: "selected_providers";
      selectedProviders: [ProviderName, ProviderName];
    }
  | {
      type: "provider_delta";
      provider: ProviderName;
      delta: string;
    }
  | {
      type: "provider_answer";
      provider: ProviderName;
      answer: string;
      duration_ms: number;
      timed_out: boolean;
      used_fallback: boolean;
      selectedProviders: [ProviderName, ProviderName];
    }
  | {
      type: "final";
      payload: {
        ok: true;
        verdict: string;
        consensus: {
          level: "high" | "medium" | "low";
          models_aligned: number;
        };
        risk_level: "low" | "moderate" | "high";
        key_disagreement: string;
        recommended_action: string;
        trust_score?: {
          score: number;
          label: "high" | "moderate" | "low";
          reason: string;
        };
        decision?: "allow" | "review" | "block";
        decision_reason?: string;
        answers: Answers;
        selectedProviders: ProviderName[];
        cached?: boolean;
        verification?: {
          final_conclusion_aligned?: boolean;
          disagreement_type?: DisagreementType;
        };
        meta?: {
          likely_conflict?: boolean;
          overlap_ratio?: number;
          agreement_summary?: string;
        };
      };
    }
  | {
      type: "error";
      error: string;
    };

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

// Generic verdict/disagreement phrases that aren't worth showing
const GENERIC_VERDICT_PHRASES = [
  "models are aligned",
  "responses support the same",
  "responses align",
  "the responses align",
  "models aligned",
  "agree on",
];

const GENERIC_DISAGREEMENT_PHRASES = [
  "minor differences in supporting detail",
  "minor differences",
  "the models differed mainly in emphasis",
  "differ mainly in emphasis",
  "none",
];

function isGenericText(text: string, phrases: string[]): boolean {
  if (!text?.trim()) return true;
  const lower = text.toLowerCase().trim();
  return phrases.some((p) => lower.includes(p));
}

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
    // ignore storage issues
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

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
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
  if (level === "high") return "border-green-500/30 bg-green-500/10 text-green-400";
  if (level === "medium")
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
  return "border-red-500/30 bg-red-500/10 text-red-400";
}

// Action-oriented confidence label — tells the user what to do, not just what the system thinks
function getConfidenceLabel(level: "high" | "medium" | "low") {
  if (level === "high") return "Safe to use";
  if (level === "medium") return "Verify before acting";
  return "Review carefully";
}

function getRiskBadgeClasses(level: "low" | "moderate" | "high") {
  if (level === "low") return "border-green-500/30 bg-green-500/10 text-green-400";
  if (level === "moderate")
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
  return "border-red-500/30 bg-red-500/10 text-red-400";
}

function getTrustBadgeClasses(label: "high" | "moderate" | "low") {
  if (label === "high") return "border-green-500/30 bg-green-500/10 text-green-400";
  if (label === "moderate")
    return "border-yellow-500/30 bg-yellow-500/10 text-yellow-400";
  return "border-red-500/30 bg-red-500/10 text-red-400";
}

function getTrustLabel(label: "high" | "moderate" | "low") {
  if (label === "high") return "Strong";
  if (label === "moderate") return "Use With Caution";
  return "Needs Review";
}

function getTrustPanelClasses(label?: "high" | "moderate" | "low") {
  if (label === "high") {
    return "border-green-500/30 bg-green-500/[0.07]";
  }
  if (label === "moderate") {
    return "border-yellow-500/30 bg-yellow-500/[0.07]";
  }
  if (label === "low") {
    return "border-red-500/30 bg-red-500/[0.07]";
  }
  return "border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]";
}

function getRiskPanelClasses(level?: "low" | "moderate" | "high") {
  if (level === "low") return "border-green-500/20 bg-green-500/[0.04]";
  if (level === "moderate") return "border-yellow-500/20 bg-yellow-500/[0.04]";
  if (level === "high") return "border-red-500/20 bg-red-500/[0.04]";
  return "border-black/10 dark:border-white/10";
}

function getDisagreementPanelClasses(label: string) {
  if (label === "Present" || label === "Conditional") {
    return "border-red-500/20 bg-red-500/[0.04]";
  }
  if (label === "Minor") {
    return "border-yellow-500/20 bg-yellow-500/[0.04]";
  }
  return "border-black/10 dark:border-white/10";
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
      className="animate-spin h-4 w-4 inline-block"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
      className="inline-flex items-center justify-center rounded-lg border border-black/10 dark:border-white/10 px-2.5 py-2 text-xs opacity-70 hover:opacity-100 transition-opacity"
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
          aria-hidden="true"
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
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

const selectedStyle = {
  border: "1px solid rgba(255,255,255,0.5)",
  background: "rgba(255,255,255,0.14)",
};

const unselectedStyle = {
  border: "1px solid rgba(255,255,255,0.1)",
};

function ProviderAnswerCard({
  provider,
  answer,
  mobileExpanded,
  onToggleMobile,
}: {
  provider: ProviderName;
  answer: string;
  mobileExpanded?: boolean;
  onToggleMobile?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-black/10 p-4 md:p-5 dark:border-white/10 space-y-3 min-w-0 overflow-hidden transition-all">
      <div className="space-y-2">
        {/* Suggestion 7: removed "Included in verification" subline — cleaner */}
        <div className="text-xs uppercase tracking-wide opacity-50">
          {getProviderLabel(provider)}
        </div>

        <button
          onClick={onToggleMobile}
          className="md:hidden inline-flex items-center gap-2 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 text-xs opacity-80 hover:opacity-100"
        >
          <span>{mobileExpanded ? "Hide response" : "View response"}</span>
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
            className={cx("transition-transform", mobileExpanded ? "rotate-180" : "")}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div
        className={cx(
          "min-w-0 max-w-full overflow-x-auto overflow-y-hidden [&_*]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words",
          mobileExpanded ? "block" : "hidden md:block"
        )}
      >
        {answer?.trim() ? (
          renderMarkdown(answer)
        ) : (
          <div className="text-sm opacity-40 animate-pulse">Thinking…</div>
        )}
      </div>
    </div>
  );
}

function LoadingProviderCard() {
  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 p-5 space-y-3">
      <div className="space-y-0.5">
        <div className="text-xs uppercase tracking-wide opacity-50">
          Verifying across multiple models…
        </div>
        <div className="text-[11px] uppercase tracking-wide opacity-35">
          Zorelan is checking agreement and disagreement
        </div>
      </div>
      <PulsePlaceholder />
    </div>
  );
}

function PrimaryActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full rounded-2xl px-4 py-3.5 text-base md:text-sm font-medium transition-all active:scale-[0.985]",
        disabled
          ? "bg-white/15 text-white/45 shadow-none"
          : "bg-white text-black shadow-sm hover:shadow-md"
      )}
    >
      {children}
    </button>
  );
}

function SecondaryActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "w-full rounded-2xl px-4 py-3 text-base md:text-sm font-medium transition-all active:scale-[0.985]",
        disabled
          ? "bg-black/20 text-black/50 dark:bg-white/10 dark:text-white/45"
          : "bg-black text-white dark:bg-white dark:text-black shadow-sm hover:shadow-md"
      )}
    >
      {children}
    </button>
  );
}

function ExampleChip({
  label,
  onClick,
}: {
  label: string;
  onClick: (value: string) => void;
}) {
  return (
    <button
      onClick={() => onClick(label)}
      className="rounded-full border border-black/10 dark:border-white/10 px-3 py-1 md:px-3 md:py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity text-left leading-snug"
    >
      {label}
    </button>
  );
}

export default function Home() {
  const [appMode, setAppMode] = useState<AppMode>("simple");
  const [mode, setMode] = useState<Mode>("decision");
  const [context, setContext] = useState<Context>("operator");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showPromptDetails, setShowPromptDetails] = useState(false);

  // Suggestion 10: default first provider expanded on mobile so users see
  // at least one answer without having to tap
  const [mobileExpandedProviders, setMobileExpandedProviders] = useState<
    Record<ProviderName, boolean>
  >({
    openai: true,
    anthropic: false,
    perplexity: false,
  });

  const [input, setInput] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [userAnswers, setUserAnswers] = useState<string[]>(["", "", ""]);

  const [answers, setAnswers] = useState<Answers | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<ProviderName[]>([]);
  const [streamingAnswers, setStreamingAnswers] = useState<Answers | null>(null);
  const [hasStreamedAnyAnswer, setHasStreamedAnyAnswer] = useState(false);
  const [isWaitingForFinal, setIsWaitingForFinal] = useState(false);

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
    const t = window.setTimeout(() => setHighlighted(false), 600);
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
    () =>
      !!answers &&
      selectedProviders.length === 2 &&
      !synthesizing &&
      !isWaitingForFinal &&
      !synthesis, // Suggestion 4: hide when synthesis already exists
    [answers, selectedProviders, synthesizing, isWaitingForFinal, synthesis]
  );

  const showPlaceholder = input.trim().length === 0;
  const hasAnyResult =
    !!intent ||
    !!answers ||
    !!streamingAnswers ||
    !!synthesis ||
    !!comparison ||
    !!decisionVerification ||
    !!trustScore;

  const shouldShowBottomCTA =
    !!trustScore || !!decisionVerification || !!comparison || !!synthesis;

  // Suggestion 5: only show verdict/disagreement when content is substantive
  const shouldShowVerdict =
    !!decisionVerification?.verdict &&
    !isGenericText(decisionVerification.verdict, GENERIC_VERDICT_PHRASES);

  const shouldShowKeyDisagreement =
    !!decisionVerification?.keyDisagreement &&
    !isGenericText(
      decisionVerification.keyDisagreement,
      GENERIC_DISAGREEMENT_PHRASES
    );

  function resetAnalysisState() {
    setIntent(null);
    setAnswers(null);
    setStreamingAnswers(null);
    setHasStreamedAnyAnswer(false);
    setIsWaitingForFinal(false);
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
    setMobileExpandedProviders({
      openai: true,
      anthropic: false,
      perplexity: false,
    });
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
      trustScore ||
      streamingAnswers
    ) {
      resetAnalysisState();
    }
  }

  function setExamplePrompt(value: string) {
    setInput(value);
    if (editableRef.current) {
      editableRef.current.innerText = value;
    }

    if (
      intent ||
      answers ||
      synthesis ||
      structuredSynthesis ||
      comparison ||
      trustScore ||
      streamingAnswers
    ) {
      resetAnalysisState();
    }
  }

  function loadEntry(entry: HistoryEntry) {
    setInput(entry.input);
    setIntent(entry.intent);
    setUserAnswers(entry.userAnswers);
    setAnswers(entry.answers);
    setStreamingAnswers(entry.answers);
    setHasStreamedAnyAnswer(!!entry.answers);
    setIsWaitingForFinal(false);
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
    setRunning(false);

    const selected = entry.selectedProviders ?? ["openai", "anthropic"];
    setMobileExpandedProviders({
      openai: selected[0] === "openai",
      anthropic: selected[0] === "anthropic",
      perplexity: selected[0] === "perplexity",
    });

    if (editableRef.current) {
      editableRef.current.innerText = entry.input;
    }
  }

  function deleteEntry(id: string, e: MouseEvent) {
    e.stopPropagation();
    const updated = history.filter((h) => h.id !== id);
    saveHistory(updated);
    setHistory(updated);
  }

  function clearHistory() {
    saveHistory([]);
    setHistory([]);
  }

  function toggleMobileProvider(provider: ProviderName) {
    setMobileExpandedProviders((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
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
    setStreamingAnswers({
      openai: "",
      anthropic: "",
      perplexity: "",
    });
    setHasStreamedAnyAnswer(false);
    setIsWaitingForFinal(true);
    setSelectedProviders([]);
    setSynthesis(null);
    setStructuredSynthesis(null);
    setComparison(null);
    setDecisionVerification(null);
    setTrustScore(null);
    setInsightCopied(false);
    setError(null);

    try {
      const rawPrompt = input.trim();
      const executionPrompt = buildPolishedPrompt(intent, userAnswers);

      const verifyRes = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: executionPrompt,
          raw_prompt: rawPrompt,
          cache_bypass: true,
          stream: true,
        }),
      });

      if (!verifyRes.ok || !verifyRes.body) {
        const fallbackJson = await verifyRes.json().catch(() => null);
        setError(fallbackJson?.error ?? "verify_failed");
        setRunning(false);
        setIsWaitingForFinal(false);
        return;
      }

      const reader = verifyRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalReceived = false;
      let streamErrored = false;

      setTimeout(() => {
        resultsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);

      const handleStreamEvent = (parsed: StreamEvent) => {
        if (parsed.type === "selected_providers") {
          setSelectedProviders(parsed.selectedProviders);
          setStreamingAnswers((prev) => ({
            ...(prev ?? { openai: "", anthropic: "", perplexity: "" }),
          }));
          // Suggestion 10: expand the first selected provider on mobile
          setMobileExpandedProviders({
            openai: parsed.selectedProviders[0] === "openai",
            anthropic: parsed.selectedProviders[0] === "anthropic",
            perplexity: parsed.selectedProviders[0] === "perplexity",
          });
          return;
        }

        if (parsed.type === "provider_delta") {
          setStreamingAnswers((prev) => {
            const current = prev ?? { openai: "", anthropic: "", perplexity: "" };
            return {
              ...current,
              [parsed.provider]: (current[parsed.provider] ?? "") + parsed.delta,
            };
          });
          setHasStreamedAnyAnswer(true);
          return;
        }

        if (parsed.type === "provider_answer") {
          setSelectedProviders(parsed.selectedProviders);
          setHasStreamedAnyAnswer(true);
          setStreamingAnswers((prev) => ({
            ...(prev ?? { openai: "", anthropic: "", perplexity: "" }),
            [parsed.provider]: parsed.answer,
          }));
          return;
        }

        if (parsed.type === "final") {
          finalReceived = true;
          const verifyJson = parsed.payload;

          const fullAnswers: Answers = verifyJson?.answers ?? {
            openai: "",
            anthropic: "",
            perplexity: "",
          };

          const providerPair = (verifyJson?.selectedProviders ?? []).slice(
            0,
            2
          ) as ProviderName[];

          setAnswers(fullAnswers);
          setStreamingAnswers(fullAnswers);
          setSelectedProviders(providerPair);

          setComparison({
            agreementLevel: verifyJson?.consensus?.level ?? "medium",
            likelyConflict: verifyJson?.meta?.likely_conflict ?? false,
            overlapRatio: verifyJson?.meta?.overlap_ratio,
            summary: verifyJson?.meta?.agreement_summary ?? "",
            finalConclusionAligned:
              verifyJson?.verification?.final_conclusion_aligned ?? undefined,
            disagreementType:
              verifyJson?.verification?.disagreement_type ?? undefined,
          });

          setDecisionVerification({
            verdict: verifyJson?.verdict ?? "",
            consensus: {
              level: verifyJson?.consensus?.level ?? "high",
              modelsAligned: verifyJson?.consensus?.models_aligned ?? 0,
            },
            riskLevel: verifyJson?.risk_level ?? "moderate",
            keyDisagreement: verifyJson?.key_disagreement ?? "",
            recommendedAction: verifyJson?.recommended_action ?? "",
            finalConclusionAligned:
              verifyJson?.verification?.final_conclusion_aligned ?? undefined,
            disagreementType:
              verifyJson?.verification?.disagreement_type ?? undefined,
          });

          setTrustScore(
            verifyJson?.trust_score
              ? {
                  score: verifyJson.trust_score.score,
                  label: verifyJson.trust_score.label,
                  reason: verifyJson.trust_score.reason,
                  decision: verifyJson.decision ?? "review",
                  decision_reason: verifyJson.decision_reason ?? "",
                }
              : null
          );

          setSynthesis(null);
          setStructuredSynthesis(null);
          setCached(verifyJson?.cached ?? false);
          setIsWaitingForFinal(false);
          setRunning(false);
          return;
        }

        if (parsed.type === "error") {
          streamErrored = true;
          setError(parsed.error ?? "stream_error");
          setIsWaitingForFinal(false);
          setRunning(false);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventBlock of events) {
          const lines = eventBlock
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

          const dataLines = lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.replace(/^data:\s*/, ""));

          if (dataLines.length === 0) continue;

          try {
            const parsed = JSON.parse(dataLines.join("\n")) as StreamEvent;
            handleStreamEvent(parsed);
          } catch {
            // ignore partial fragments
          }
        }
      }

      const leftover = buffer.trim();
      if (leftover) {
        const lines = leftover
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const dataLines = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.replace(/^data:\s*/, ""));

        if (dataLines.length > 0) {
          try {
            const parsed = JSON.parse(dataLines.join("\n")) as StreamEvent;
            handleStreamEvent(parsed);
          } catch {
            // ignore
          }
        }
      }

      if (!finalReceived && !streamErrored) {
        setError("stream_incomplete");
        setIsWaitingForFinal(false);
        setRunning(false);
      }
    } catch {
      setError("verify_failed");
      setIsWaitingForFinal(false);
      setRunning(false);
    }
  }

  async function onSynthesize() {
    if (!intent || !answers || selectedProviders.length !== 2) return;

    setSynthesizing(true);
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
    const prompt =
      text ?? (intent ? buildPolishedPrompt(intent, userAnswers) : "");
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
    }
  }

  const AI_BUTTONS = [
    { name: "ChatGPT" },
    { name: "Claude" },
    { name: "Gemini" },
    { name: "Perplexity" },
  ];

  const EXAMPLES = [
    "Should I trust AI for medical advice?",
    "Should I use REST or GraphQL for a new API?",
    "What is the safest way to store passwords?",
    "Should I raise venture capital or bootstrap my startup?",
  ];

  const comparisonProviders: ProviderName[] =
    selectedProviders.length === 2
      ? selectedProviders
      : ["openai", "anthropic"];

  const displayedAnswers = streamingAnswers ?? answers;

  const showComparisonSection =
    selectedProviders.length === 2 &&
    (hasStreamedAnyAnswer ||
      !!displayedAnswers?.openai ||
      !!displayedAnswers?.anthropic ||
      !!displayedAnswers?.perplexity);

  // Suggestion 6: confidence level derived from risk, action-oriented label
  const displayedConfidenceLevel: "high" | "medium" | "low" =
    decisionVerification?.riskLevel === "low"
      ? "high"
      : decisionVerification?.riskLevel === "moderate"
        ? "medium"
        : decisionVerification?.riskLevel === "high"
          ? "low"
          : decisionVerification?.consensus.level ??
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

  const apiBridgePrompt =
    input.trim() || "Should I use AI output directly in production?";

  function HistoryList() {
    if (history.length === 0) {
      return (
        <div className="px-5 py-8 text-center text-xs opacity-40">
          No history yet. Run a verification to save it here.
        </div>
      );
    }

    return (
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
                {/* Suggestion 9: single consistent label for completed verifications */}
                {(entry.synthesis || entry.answers) && (
                  <span className="text-xs opacity-40">· verified</span>
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
  }

  // Suggestion 4: only show synthesize button when synthesis doesn't exist yet
  function SynthesizeButton() {
    if (synthesis) return null;
    return (
      <SecondaryActionButton onClick={onSynthesize} disabled={!canSynthesize}>
        {synthesizing ? (
          <span className="inline-flex items-center gap-2">
            <Spinner />
            Generating verified answer…
          </span>
        ) : (
          "Generate Verified Answer"
        )}
      </SecondaryActionButton>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 md:py-10">
      {historyOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      {/* Floating pill — keep this, remove inline phase banner (suggestion 2) */}
      {isWaitingForFinal && hasStreamedAnyAnswer && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] md:bottom-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black text-white px-4 py-2 text-xs shadow-2xl">
            <Spinner />
            <span>Verifying trust, disagreement, and risk…</span>
          </div>
        </div>
      )}

      {/* Desktop history sidebar */}
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

      {/* Mobile history drawer */}
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

      <div className="mx-auto w-full max-w-5xl space-y-6 md:space-y-8">
        <header className="space-y-4 md:space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xl md:text-2xl font-semibold tracking-tight">
              Zorelan
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryOpen(true)}
                className="flex items-center gap-1.5 rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
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
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{history.length > 0 ? history.length : "History"}</span>
              </button>

              <a
                href="/api-docs"
                className="flex items-center rounded-xl border border-black/10 dark:border-white/10 px-3 py-1.5 text-xs opacity-70 hover:opacity-100 transition-opacity"
              >
                API Docs
              </a>
            </div>
          </div>

          <div className="mx-auto max-w-4xl text-center space-y-2 md:space-y-3">
            <h1 className="text-[2.5rem] leading-[1.02] font-semibold tracking-tight md:text-6xl md:leading-[0.98]">
              Ship AI safely<br />or don't ship it at all.
            </h1>

            <p className="text-sm leading-relaxed opacity-65 max-w-xs mx-auto md:hidden">
              Zorelan verifies AI outputs before your system acts on them. Run your prompt through multiple AI models, compare their answers, and get a trust score and decision: allow, review, or block.
            </p>

            <p className="hidden md:block text-base opacity-65 leading-relaxed max-w-3xl mx-auto">
              Zorelan verifies AI outputs before your system acts on them. Run your prompt through multiple AI models, compare their answers, and get a trust score and decision: allow, review, or block.
            </p>

            <p className="text-sm text-center opacity-55 leading-relaxed">
              AI can sound confident and still be wrong. Zorelan checks before your system acts.
            </p>

            <p className="text-sm text-center">
              <a
                href="/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="opacity-70 hover:opacity-100 transition-opacity underline underline-offset-2"
              >
                Run the demo — see how Zorelan catches unsafe AI decisions →
              </a>
            </p>

            <p className="text-xs text-center opacity-50 tracking-wide font-mono">
              One prompt → multiple AI models → detect disagreement → assign trust → decide if it's safe to act
            </p>
          </div>
        </header>

        <p className="text-xs text-center opacity-60 tracking-wide -mt-2">
          Multiple models · Disagreement detection · Trust scoring · Execution decision
        </p>

        <section className="rounded-3xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] p-4 md:p-6 space-y-4 md:space-y-5">
          <div className="md:flex md:items-start md:justify-between md:gap-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide opacity-50">
                <span className="md:hidden">Verify an AI output or decision</span>
                <span className="hidden md:inline">Verify an AI output or decision</span>
              </div>
              <p className="hidden md:block text-sm opacity-60 leading-relaxed max-w-2xl">
                Describe an AI-generated answer or decision you want to verify before acting.
              </p>
            </div>

            <div className="hidden md:inline-flex rounded-xl border border-black/10 dark:border-white/10 p-1">
              <button
                onClick={() => setAppMode("simple")}
                className={cx(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  appMode === "simple"
                    ? "bg-white text-black shadow-sm"
                    : "opacity-55 hover:opacity-85"
                )}
              >
                Quick Verify
              </button>
              <button
                onClick={() => setAppMode("pro")}
                className={cx(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  appMode === "pro"
                    ? "bg-white text-black shadow-sm"
                    : "opacity-55 hover:opacity-85"
                )}
              >
                Add Context
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="relative">
              {showPlaceholder && (
                <div
                  className="absolute top-0 left-0 w-full p-4 text-base md:text-sm pointer-events-none select-none opacity-30 leading-relaxed"
                  aria-hidden="true"
                >
                  Describe the decision you want to verify…
                  <div className="hidden md:block mt-4">
                    Examples: "Should I trust AI for medical advice?" or "Should
                    I use REST or GraphQL?" or "What is the safest way to store
                    passwords?"
                  </div>
                </div>
              )}

              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning
                onInput={handleEditableInput}
                className="min-h-36 md:min-h-40 w-full rounded-2xl border border-black/10 dark:border-white/10 bg-transparent p-4 text-base md:text-sm outline-none focus:border-black/30 dark:focus:border-white/30 leading-relaxed"
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              />
            </div>
          </div>

          {/* Suggestion 8: example chips — visible when no result, naturally hidden when result exists */}
          {!hasAnyResult && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <ExampleChip
                  key={example}
                  label={example}
                  onClick={setExamplePrompt}
                />
              ))}
            </div>
          )}

          <PrimaryActionButton onClick={onPreframe} disabled={!canRun}>
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Spinner />
                Structuring for verification…
              </span>
            ) : (
              "Evaluate Decision"
            )}
          </PrimaryActionButton>

          {/* Mobile advanced options */}
          <div className="space-y-3 md:hidden">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-2 text-xs opacity-60 hover:opacity-100 transition-opacity"
            >
              <span>{advancedOpen ? "Hide" : "Add"} context</span>
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
                className={cx(
                  "transition-transform duration-200",
                  advancedOpen ? "rotate-180" : ""
                )}
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {advancedOpen && (
              <div className="grid gap-4">
                <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-4">
                  <div className="text-xs uppercase tracking-wide opacity-50">Context</div>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => setContext(c)}
                        style={c === context ? selectedStyle : unselectedStyle}
                        className="rounded-xl px-3 py-3 text-sm"
                      >
                        {CONTEXT_LABEL[c]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-4">
                  <div className="text-xs uppercase tracking-wide opacity-50">
                    Verification Type
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={m === mode ? selectedStyle : unselectedStyle}
                        className="rounded-xl px-3 py-3 text-sm"
                      >
                        {MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Desktop advanced options */}
          {appMode === "pro" && (
            <div className="hidden md:grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-4">
                <div className="text-xs uppercase tracking-wide opacity-50">Context</div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(CONTEXT_LABEL) as Context[]).map((c) => (
                    <button
                      key={c}
                      onClick={() => setContext(c)}
                      style={c === context ? selectedStyle : unselectedStyle}
                      className="rounded-xl px-3 py-3 text-sm"
                    >
                      {CONTEXT_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-4">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Verification Type
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      style={m === mode ? selectedStyle : unselectedStyle}
                      className="rounded-xl px-3 py-3 text-sm"
                    >
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!intent && !busy && (
            <p className="text-center text-xs opacity-45 leading-relaxed">
              <span className="md:hidden">
                One question. Multiple models. Trust and risk before action.
              </span>
              <span className="hidden md:inline">
                One input. Multiple models. Trust and risk shown before action.
              </span>
            </p>
          )}
        </section>

        {error && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Something went wrong: <span className="font-mono">{error}</span>.
            Please try again.
          </section>
        )}

        {busy && (
          <section className="rounded-2xl border border-black/10 dark:border-white/10 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide opacity-50">
                Preparing verification
              </div>
              <p className="text-sm opacity-55">
                Structuring your request for stronger cross-model checking…
              </p>
            </div>
            <PulsePlaceholder />
          </section>
        )}

        {intent && !busy && (
          <section className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Verification is ready
                </div>
                <p className="text-sm opacity-55 leading-relaxed max-w-2xl">
                  Review the verification-ready prompt, add optional context,
                  then run it across multiple models.
                </p>
              </div>
            </div>

            {intent.inputs_needed.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Add context for stronger verification{" "}
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
                      className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 py-2.5 text-base md:text-sm outline-none focus:border-black/30 dark:focus:border-white/30"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => setShowPromptDetails((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2 text-sm hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors"
              >
                <span>
                  {showPromptDetails
                    ? "Hide how Zorelan structured this"
                    : "See how Zorelan structured this"}
                </span>
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
                  className={cx(
                    "transition-transform duration-200",
                    showPromptDetails ? "rotate-180" : ""
                  )}
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {showPromptDetails && (
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
                    Verification-ready prompt
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {buildPolishedPrompt(intent, userAnswers)}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-2">
              {AI_BUTTONS.map((a) => (
                <button
                  key={a.name}
                  onClick={() => openAI(a.name)}
                  className="rounded-xl border border-black/10 dark:border-white/10 px-3 py-2.5 text-base md:text-sm opacity-85 hover:opacity-100 transition-all"
                >
                  {a.name === "ChatGPT" ? "ChatGPT (copies)" : a.name}
                </button>
              ))}
            </div>

            <PrimaryActionButton onClick={onRunAnalysis} disabled={!canAnalyse}>
              {running ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  Running verification across multiple AIs…
                </span>
              ) : (
                "Evaluate Decision"
              )}
            </PrimaryActionButton>

            {!running && !answers && (
              <p className="text-sm md:text-xs text-center opacity-55 mt-1">
                Zorelan will compare multiple model outputs and score how much
                trust the result deserves.
              </p>
            )}
          </section>
        )}

        {running && !showComparisonSection && (
          <section ref={resultsRef} className="space-y-4">
            <div className="rounded-2xl border border-black/10 dark:border-white/10 p-5 space-y-4">
              <div className="space-y-1 text-center md:text-left">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Verifying now
                </div>
                <p className="text-sm opacity-55">
                  Checking agreement, disagreement, and risk across multiple models…
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <LoadingProviderCard />
                <LoadingProviderCard />
              </div>
            </div>
          </section>
        )}

        {showComparisonSection && (
          <section ref={resultsRef} className="space-y-4">
            {/* Suggestion 2: removed inline phase banner — floating pill handles this */}

            <div className="text-xs text-center opacity-60 tracking-wide font-mono mb-4">
              Input → Models → Zorelan → Decision → Execute / Block
            </div>
            <div className="text-xs text-center opacity-40 mt-1">
              Most production AI systems gate outputs before execution.
            </div>

            {(trustScore || decisionVerification) && (
              <div
                className={cx(
                  "rounded-2xl border p-5 space-y-5",
                  getTrustPanelClasses(trustScore?.label)
                )}
              >
                <div className="space-y-1 text-center md:text-left">
                  <div className="text-xs uppercase tracking-wide opacity-35 mb-0.5">
                    System execution decision
                  </div>
                  <div className="text-xs uppercase tracking-wide opacity-50">
                    Verification Result
                  </div>
                  <p className="text-sm opacity-55">Can this answer be trusted?</p>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {cached && (
                      <div className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-white/50">
                        ⚡ Cached result · verified earlier
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Suggestion 6: action-oriented confidence label */}
                    <div
                      className={cx(
                        "text-xs font-medium px-3 py-1 rounded-full border",
                        getConfidenceBadgeClasses(displayedConfidenceLevel)
                      )}
                    >
                      {getConfidenceLabel(displayedConfidenceLevel)}
                    </div>

                    {decisionVerification && (
                      <div
                        className={cx(
                          "text-xs font-medium px-3 py-1 rounded-full border",
                          getRiskBadgeClasses(decisionVerification.riskLevel)
                        )}
                      >
                        {decisionVerification.riskLevel === "low"
                          ? "Low Risk"
                          : decisionVerification.riskLevel === "moderate"
                            ? "Moderate Risk"
                            : "High Risk"}
                      </div>
                    )}

                    {trustScore && (
                      <div
                        className={cx(
                          "text-xs font-medium px-3 py-1 rounded-full border",
                          getTrustBadgeClasses(trustScore.label)
                        )}
                      >
                        Trust {trustScore.score} · {getTrustLabel(trustScore.label)}
                      </div>
                    )}
                  </div>
                </div>

                {trustScore?.decision && (
                  <div
                    className={cx(
                      "rounded-xl border px-5 py-4",
                      trustScore.decision === "allow"
                        ? "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
                        : trustScore.decision === "review"
                          ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400"
                          : "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-60 mb-1">System Decision</div>
                    <div className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
                      {trustScore.decision === "allow"
                        ? "SAFE TO EXECUTE"
                        : trustScore.decision === "review"
                        ? "HUMAN REVIEW REQUIRED"
                        : "BLOCKED"}
                    </div>

                    <div className="text-xs opacity-70 leading-relaxed">
  {trustScore.decision === "allow"
    ? "This output meets reliability thresholds and can be executed."
    : trustScore.decision === "review"
    ? "This output is not safe for automatic execution. Human validation required."
    : "Execution prevented due to high risk or conflicting signals."}
</div>
                    {trustScore.decision_reason && (
                      <p className="text-xs opacity-70 leading-relaxed">
                        {trustScore.decision_reason}
                      </p>
                    )}
                  </div>
                )}

                {/* Suggestion 3: trust score card visually dominant — larger, full-width feel */}
                <div className="grid gap-3 md:grid-cols-4">
                  <div
                    className={cx(
                      "rounded-xl border p-5 md:col-span-2",
                      getTrustPanelClasses(trustScore?.label)
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-50 mb-2">
                      Trust Score
                    </div>
                    <div className="flex items-end gap-3 mb-3">
                      <div className="text-5xl md:text-6xl font-semibold tracking-tight leading-none">
                        {trustScore ? `${trustScore.score}` : "—"}
                      </div>
                      <div className="text-base opacity-35 pb-1">/100</div>
                      {trustScore && (
                        <div
                          className={cx(
                            "mb-1 text-xs font-medium px-3 py-1 rounded-full border",
                            getTrustBadgeClasses(trustScore.label)
                          )}
                        >
                          {getTrustLabel(trustScore.label)}
                        </div>
                      )}
                    </div>
                    <p className="text-xs opacity-60 leading-relaxed max-w-xl">
                      {trustScore?.reason ?? "Trust score not returned"}
                    </p>
                  </div>

                  <div
                    className={cx(
                      "rounded-xl border p-4",
                      getRiskPanelClasses(decisionVerification?.riskLevel)
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-50 mb-1">
                      Consensus
                    </div>
                    <div className="text-2xl font-semibold tracking-tight capitalize">
                      {displayedConsensusLevel}
                    </div>
                    <p className="text-xs opacity-60 mt-1">
                      {decisionVerification
                        ? `${decisionVerification.consensus.modelsAligned} models aligned`
                        : "Agreement from compared outputs"}
                    </p>
                  </div>

                  <div
                    className={cx(
                      "rounded-xl border p-4",
                      getDisagreementPanelClasses(displayedDisagreementLabel)
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-50 mb-1">
                      Disagreement
                    </div>
                    <div className="text-2xl font-semibold tracking-tight">
                      {displayedDisagreementLabel}
                    </div>
                    <p className="text-xs opacity-60 mt-1">
                      {comparison?.summary || "Zorelan detected the shape of disagreement"}
                    </p>
                  </div>
                </div>

                {decisionVerification?.recommendedAction && (
                  <div
                    className={cx(
                      "rounded-xl border p-4",
                      getRiskPanelClasses(decisionVerification.riskLevel)
                    )}
                  >
                    <div className="text-xs uppercase tracking-wide opacity-50 mb-1">
                      Recommended Action
                    </div>
                    <div className="text-sm leading-relaxed">
                      {decisionVerification.recommendedAction}
                    </div>
                  </div>
                )}

                {/* Suggestion 5: only show verdict/disagreement when substantive */}
                {(shouldShowVerdict || shouldShowKeyDisagreement) && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {shouldShowVerdict && (
                      <InsightBlock
                        title="Verdict"
                        value={decisionVerification?.verdict ?? ""}
                      />
                    )}
                    {shouldShowKeyDisagreement && (
                      <InsightBlock
                        title="Key disagreement"
                        value={decisionVerification?.keyDisagreement ?? ""}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div className="space-y-1 text-center md:text-left">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Compared Outputs
                </div>
                <p className="text-sm opacity-55">
                  See where the models align, diverge, or add nuance.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {comparisonProviders.map((provider) => (
                  <ProviderAnswerCard
                    key={provider}
                    provider={provider}
                    answer={displayedAnswers?.[provider] ?? ""}
                    mobileExpanded={mobileExpandedProviders[provider]}
                    onToggleMobile={() => toggleMobileProvider(provider)}
                  />
                ))}
              </div>
            </div>

            {/* Suggestion 4: button hidden when synthesis already exists */}
            <div className="pt-1">
              <SynthesizeButton />
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-black/10 dark:border-white/10 p-5 md:p-6 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide opacity-50">
              Where Zorelan fits in your system
            </div>
            <p className="text-sm md:text-base opacity-65 leading-relaxed max-w-3xl">
              Zorelan sits between AI output and execution, deciding whether your system should act at all.
            </p>
            <div className="text-xs font-mono opacity-50 mt-1">
              User input → Your app → Zorelan → Decision → Execute or Block
            </div>
            <pre className="mt-4 rounded-xl border border-white/10 bg-black text-white text-xs leading-relaxed p-4 overflow-x-auto">{`const result = await zorelan.verify(prompt)

if (result.decision === "allow") {
  execute()
} else {
  block()
}`}</pre>
          </div>
        </section>

        <section className="rounded-3xl border border-black/10 dark:border-white/10 p-5 md:p-6 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="space-y-4">
            <div className="text-xs uppercase tracking-wide opacity-50">
              What happens without Zorelan
            </div>
            <p className="text-sm md:text-base opacity-65 leading-relaxed max-w-3xl">
              AI responses can be correct — but still unsafe to act on. Without a verification layer, systems execute blindly.
            </p>
            <ul className="space-y-2">
              <li className="text-sm opacity-65 leading-relaxed">· Refunds triggered without verified context</li>
              <li className="text-sm opacity-65 leading-relaxed">· Policies applied incorrectly due to missing nuance</li>
              <li className="text-sm opacity-65 leading-relaxed">· Confident but incomplete answers sent to users</li>
              <li className="text-sm opacity-65 leading-relaxed">· Actions executed without understanding real-world risk</li>
            </ul>
            <p className="text-sm opacity-65 leading-relaxed max-w-3xl">
              Zorelan prevents this by deciding whether an action should happen at all — not just whether an answer looks correct.
            </p>
          </div>
        </section>

        {synthesizing && (
          <section className="rounded-2xl border border-black/10 dark:border-white/10 p-5 space-y-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide opacity-50">
                Generating verified answer
              </div>
              <p className="text-sm opacity-55">
                Synthesizing the strongest shared conclusion across the selected models…
              </p>
            </div>
            <PulsePlaceholder />
          </section>
        )}

        {synthesis && !synthesizing && (
          <section
            ref={synthesisRef}
            className="rounded-2xl border border-black/10 dark:border-white/10 p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide opacity-50">
                  Verified Output
                </div>
                <p className="text-sm opacity-55">
                  Synthesized from multiple models with agreement weighting.
                </p>
              </div>

              {(comparison || decisionVerification) && (
                <div
                  className={cx(
                    "text-xs font-medium px-3 py-1 rounded-full border",
                    getConfidenceBadgeClasses(displayedConfidenceLevel)
                  )}
                >
                  {getConfidenceLabel(displayedConfidenceLevel)}
                </div>
              )}
            </div>

            <div className="relative space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-4 pr-16 overflow-hidden">
              <div className="absolute top-3 right-3">
                <CopyIconButton
                  copied={insightCopied}
                  onClick={onCopyInsight}
                  label="Copy verified output"
                />
              </div>
              <div className="text-xs uppercase tracking-wide opacity-50">
                Final verified answer
              </div>
              <div className="min-w-0 max-w-full overflow-x-auto [&_*]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:break-words">
                {renderMarkdown(synthesis)}
              </div>
            </div>

            {structuredSynthesis && (
              <div className="grid gap-3 md:grid-cols-2">
                <InsightBlock
                  title="Shared conclusion"
                  value={structuredSynthesis.sharedConclusion}
                />
                <InsightBlock
                  title="Key difference"
                  value={structuredSynthesis.keyDifference}
                />
                <InsightBlock
                  title="Decision rule"
                  value={structuredSynthesis.decisionRule}
                />
                <InsightBlock
                  title="Final answer"
                  value={structuredSynthesis.finalAnswer}
                />
              </div>
            )}
          </section>
        )}

        {/* Suggestion 1: single consolidated CTA block — removed the duplicate code/snippet one */}
        {shouldShowBottomCTA && (
          <section className="rounded-3xl border border-black/10 dark:border-white/10 p-5 md:p-6 space-y-4 bg-black/[0.02] dark:bg-white/[0.02]">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide opacity-50">
                Use Zorelan in production
              </div>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
                Gate AI execution in production
              </h2>
              <div className="text-xs opacity-50 mt-1">
                Add a decision layer between your models and real-world actions.
              </div>
              <p className="text-sm md:text-base opacity-65 leading-relaxed max-w-3xl">
                Use the API to verify and control AI output with trust scoring, disagreement detection, and execution decisions — before it reaches users or systems.
              </p>
              <pre className="mt-4 rounded-xl border border-white/10 bg-black text-white text-xs leading-relaxed p-4 overflow-x-auto">{`const result = await zorelan.verify(prompt)

if (result.decision === "allow") {
  execute(result.output)
} else {
  block()
}`}</pre>
              <div className="text-xs opacity-40 mt-2">
                ~300–800ms verification latency • deterministic scoring • production safe
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href="/api-docs"
                className="inline-flex items-center justify-center rounded-2xl bg-white text-black px-4 py-3 text-sm font-medium shadow-sm hover:shadow-md transition-all"
              >
                View API Docs
              </a>
              <a
                href="/api-docs"
                className="inline-flex items-center justify-center rounded-2xl border border-black/10 dark:border-white/10 px-4 py-3 text-sm font-medium opacity-85 hover:opacity-100 transition-all"
              >
                Gate Your AI Pipeline
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}