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

type Analytics = {
  total: number;
  triggered: number;
  changed: number;
  confirmed: number;
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
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [providerAnalytics, setProviderAnalytics] = useState<Record<string, Record<string, Record<string, number | null>>> | null>(null);
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

      // Load provider analytics
      try {
        const providerRes = await fetch("/api/provider-analytics", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const providerData = await providerRes.json();
        if (providerData.ok) {
          setProviderAnalytics(providerData.taskTypes);
        }
      } catch {
        // Provider analytics load failure is non-fatal
      }

      // Load arbitration analytics
      try {
        const analyticsRes = await fetch("/api/analytics", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const analyticsData = await analyticsRes.json();
        if (analyticsData.ok) {
          setAnalytics(analyticsData.analytics);
        }
      } catch {
        // Analytics load failure is non-fatal
      }

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
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Zorelan dashboard
          </p>
        </div>
        <button
          onClick={() => {
            setAuthenticated(false);
            setFeedback([]);
            setAnalytics(null);
            setProviderAnalytics(null);
            setApiKey("");
          }}
          className="text-sm text-white/30 hover:text-white/60 transition-colors"
        >
          Sign out
        </button>
      </div>
      
      {providerAnalytics && (
        <div className="rounded-2xl border border-white/10 p-5 mb-8 space-y-6">
          <div className="text-xs uppercase tracking-widest text-white/30">
            Provider Performance
          </div>
          {Object.entries(providerAnalytics).map(([taskType, providers]) => (
            <div key={taskType} className="space-y-3">
              <div className="text-xs font-medium text-white/50 capitalize">
                {taskType}
              </div>
              <div className="rounded-xl border border-white/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03]">
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widest">Provider</th>
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widest">Score</th>
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widest">Quality</th>
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widest">Latency</th>
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widest">Timeouts</th>
                      <th className="text-left px-4 py-2 text-white/30 uppercase tracking-widests">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(providers).map(([provider, metrics]) => (
                      <tr key={provider} className="border-b border-white/10 last:border-0">
                        <td className="px-4 py-3 text-white/70 font-medium capitalize">{provider}</td>
                        <td className="px-4 py-3 text-white/60">{(metrics as Record<string, number | null>).score ?? "—"}</td>
                        <td className="px-4 py-3 text-white/60">
                          {(metrics as Record<string, number | null>).avgQuality != null
                            ? (metrics as Record<string, number | null>).avgQuality
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          {(metrics as Record<string, number | null>).avgLatencyMs != null
                            ? `${(metrics as Record<string, number | null>).avgLatencyMs}ms`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-white/60">
                          {(metrics as Record<string, number | null>).timeoutRate != null
                            ? `${Math.round(((metrics as Record<string, number | null>).timeoutRate as number) * 100)}%`
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-white/60">{(metrics as Record<string, number | null>).sampleCount ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {analytics && (
        <div className="rounded-2xl border border-white/10 p-5 mb-8 space-y-4">
          <div className="text-xs uppercase tracking-widest text-white/30">
            Arbitration Analytics
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-white/10 p-4 space-y-1">
              <div className="text-xs text-white/30 uppercase tracking-widest">
                Total requests
              </div>
              <div className="text-2xl font-semibold">{analytics.total}</div>
            </div>
            <div className="rounded-xl border border-white/10 p-4 space-y-1">
              <div className="text-xs text-white/30 uppercase tracking-widest">
                Triggered
              </div>
              <div className="text-2xl font-semibold">{analytics.triggered}</div>
              <div className="text-xs text-white/40">
                {analytics.total > 0
                  ? `${Math.round((analytics.triggered / analytics.total) * 100)}% of requests`
                  : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 p-4 space-y-1">
              <div className="text-xs text-white/30 uppercase tracking-widest">
                Changed verdict
              </div>
              <div className="text-2xl font-semibold text-green-400">
                {analytics.changed}
              </div>
              <div className="text-xs text-white/40">
                {analytics.triggered > 0
                  ? `${Math.round((analytics.changed / analytics.triggered) * 100)}% of triggered`
                  : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 p-4 space-y-1">
              <div className="text-xs text-white/30 uppercase tracking-widest">
                Confirmed initial
              </div>
              <div className="text-2xl font-semibold text-white/40">
                {analytics.confirmed}
              </div>
              <div className="text-xs text-white/40">
                {analytics.triggered > 0
                  ? `${Math.round((analytics.confirmed / analytics.triggered) * 100)}% of triggered`
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Feedback</h2>
          <p className="text-white/40 text-sm mt-0.5">
            {feedback.length} {feedback.length === 1 ? "record" : "records"}
          </p>
        </div>
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
                    <div className="text-xs uppercase tracking-widests text-white/30 mb-1">
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