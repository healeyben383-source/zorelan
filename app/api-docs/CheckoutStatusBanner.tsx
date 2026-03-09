"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type SessionKeyResponse =
  | {
      ok: true;
      apiKey: string;
      plan: string;
      callsLimit: number;
      email: string | null;
    }
  | {
      ok: false;
      error: string;
    };

export default function CheckoutStatusBanner() {
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const sessionId = searchParams.get("session_id");

  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<SessionKeyResponse | null>(null);

  const isSuccess = checkout === "success" && !!sessionId;
  const isCancelled = checkout === "cancelled";

  useEffect(() => {
    if (!isSuccess || !sessionId) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    async function poll() {
      if (cancelled) return;

      attempts += 1;
      setLoading(true);

      try {
        const res = await fetch(
          `/api/checkout/session-key?session_id=${encodeURIComponent(sessionId)}`,
          { cache: "no-store" }
        );

        const data = (await res.json()) as SessionKeyResponse;

        if (cancelled) return;

        if (data.ok) {
          setResult(data);
          setLoading(false);
          return;
        }

        if (
          data.error === "pending_key_generation" &&
          attempts < maxAttempts
        ) {
          setTimeout(poll, 1000);
          return;
        }

        setResult(data);
        setLoading(false);
      } catch {
        if (attempts < maxAttempts) {
          setTimeout(poll, 1000);
          return;
        }

        setResult({ ok: false, error: "key_lookup_failed" });
        setLoading(false);
      }
    }

    poll();

    return () => {
      cancelled = true;
    };
  }, [isSuccess, sessionId]);

  const curlExample = useMemo(() => {
    if (!result || !result.ok) return null;

    return `curl -X POST https://zorelan.com/api/decision \\
  -H "Authorization: Bearer ${result.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Should I hire staff or stay solo?"}'`;
  }, [result]);

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  if (isCancelled) {
    return (
      <section className="mb-8 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-5">
        <div className="text-sm uppercase tracking-widest text-yellow-300/70 mb-2">
          Checkout cancelled
        </div>
        <p className="text-yellow-100/90">
          Your subscription checkout was cancelled. You can choose a plan and
          try again below.
        </p>
      </section>
    );
  }

  if (!isSuccess) return null;

  return (
    <section className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-5 space-y-4">
      <div>
        <div className="text-sm uppercase tracking-widest text-emerald-300/70 mb-2">
          Checkout successful
        </div>
        <h2 className="text-2xl font-semibold text-white">
          Your Zorelan API key
        </h2>
      </div>

      {loading && !result && (
        <p className="text-white/70">
          Finalising your API access and retrieving your key…
        </p>
      )}

      {result?.ok && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs uppercase tracking-widest text-white/40 mb-2">
              API key
            </div>
            <code className="block break-all text-sm text-white/90">
              {result.apiKey}
            </code>
          </div>

          <div className="flex flex-wrap gap-3 text-sm text-white/70">
            <span className="rounded-full border border-white/10 px-3 py-1">
              Plan: {result.plan}
            </span>
            <span className="rounded-full border border-white/10 px-3 py-1">
              Monthly limit: {result.callsLimit}
            </span>
            {result.email && (
              <span className="rounded-full border border-white/10 px-3 py-1">
                Sent to: {result.email}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleCopy(result.apiKey)}
              className="rounded-xl bg-white text-black px-4 py-2 text-sm font-medium hover:bg-white/90 transition"
            >
              {copied ? "Copied" : "Copy API key"}
            </button>
          </div>

          {curlExample && (
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="text-xs uppercase tracking-widest text-white/40 mb-2">
                Quick test
              </div>
              <pre className="text-sm whitespace-pre-wrap break-words text-white/80">
                {curlExample}
              </pre>
            </div>
          )}
        </div>
      )}

      {result && !result.ok && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-100/90">
          {result.error === "pending_key_generation" &&
            "Your payment succeeded, but the key is still being provisioned. Refresh the page in a few seconds."}
          {result.error === "session_not_found" &&
            "We could not find that checkout session."}
          {result.error === "checkout_not_completed" &&
            "This checkout session has not completed yet."}
          {result.error === "api_key_not_found" &&
            "The checkout completed, but no API key was found for it yet."}
          {result.error === "missing_session_id" &&
            "Missing session ID in the return URL."}
          {result.error === "key_lookup_failed" &&
            "We could not retrieve your API key right now. Please check your email or try again shortly."}
        </div>
      )}
    </section>
  );
}