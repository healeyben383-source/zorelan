"use client";

import { useState } from "react";

type FeedbackRecord = {
  id: string;
  submittedAt: number;
  submittedBy: "api_key" | "master_key";
  prompt: string;
  verdict: string;
  issue: string;
  correct_answer: string;
  request_id?: string;
  notes?: string;
};

const ISSUE_LABELS: Record<string, string> = {
  incorrect_verdict: "Incorrect verdict",
  wrong_agreement_level: "Wrong agreement level",
  missing_nuance: "Missing nuance",
  other: "Other",
};

const ISSUE_COLOURS: Record<string, string> = {
  incorrect_verdict: "bg-red-500/15 text-red-400 border-red-500/20",
  wrong_agreement_level: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
  missing_nuance: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  other: "bg-white/10 text-white/50 border-white/10",
};

export default function AdminPage() {
  const [apiKey, setApiKey] = useState("");
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function loadFeedback() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/feedback", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error === "forbidden" || data.error === "unauthorized"
          ? "Invalid master key."
          : "Failed to load feedback.");
        return;
      }

      setFeedback(data.feedback);
      setAuthenticated(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function formatDate(ts: number) {
    return new Date(ts).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (!authenticated) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold mb-1">Admin</h1>
            <p className="text-white/40 text-sm">Zorelan feedback dashboard</p>
          </div>
          <input
            type="password"
            placeholder="Master API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadFeedback()}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/30"
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            onClick={loadFeedback}
            disabled={loading || !apiKey.trim()}
            className="w-full bg-white text-black rounded-xl py-3 text-sm font-semibold disabled:opacity-40"
          >
            {loading ? "Loading..." : "View Feedback"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-semibold">Feedback</h1>
          <p className="text-white/40 text-sm mt-0.5">
            {feedback.length} {feedback.length === 1 ? "record" : "records"}
          </p>
        </div>
        <button
          onClick={() => {
            setAuthenticated(false);
            setFeedback([]);
            setApiKey("");
          }}
          className="text-sm text-white/30 hover:text-white/60 transition-colors"
        >
          Sign out
        </button>
      </div>

      {feedback.length === 0 ? (
        <div className="rounded-2xl border border-white/10 p-12 text-center">
          <p className="text-white/30 text-sm">No feedback submitted yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feedback.map((record) => (
            <div
              key={record.id}
              className="rounded-2xl border border-white/10 overflow-hidden"
            >
              <button
                onClick={() =>
                  setExpanded(expanded === record.id ? null : record.id)
                }
                className="w-full text-left px-5 py-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                        ISSUE_COLOURS[record.issue] ?? ISSUE_COLOURS.other
                      }`}
                    >
                      {ISSUE_LABELS[record.issue] ?? record.issue}
                    </span>
                    <span className="text-xs text-white/30">
                      {record.submittedBy === "master_key" ? "You" : "Developer"}
                    </span>
                    <span className="text-xs text-white/30">
                      {formatDate(record.submittedAt)}
                    </span>
                  </div>
                  <p className="text-sm text-white/70 truncate">
                    {record.prompt}
                  </p>
                </div>
                <span className="text-white/30 text-xs mt-1 shrink-0">
                  {expanded === record.id ? "▲" : "▼"}
                </span>
              </button>

              {expanded === record.id && (
                <div className="border-t border-white/10 px-5 py-4 space-y-4 bg-white/[0.02]">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                      Prompt
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed">
                      {record.prompt}
                    </p>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                      Zorelan verdict
                    </div>
                    <p className="text-sm text-white/70 leading-relaxed">
                      {record.verdict}
                    </p>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                      Correct answer
                    </div>
                    <p className="text-sm text-white/80 leading-relaxed">
                      {record.correct_answer}
                    </p>
                  </div>

                  {record.notes && (
                    <div>
                      <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                        Notes
                      </div>
                      <p className="text-sm text-white/60 leading-relaxed">
                        {record.notes}
                      </p>
                    </div>
                  )}

                  {record.request_id && (
                    <div>
                      <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                        Request ID
                      </div>
                      <p className="text-sm font-mono text-white/40">
                        {record.request_id}
                      </p>
                    </div>
                  )}

                  <div>
                    <div className="text-xs uppercase tracking-widest text-white/30 mb-1">
                      Record ID
                    </div>
                    <p className="text-sm font-mono text-white/30">
                      {record.id}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}