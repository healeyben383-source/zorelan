"use client";

import { useState } from "react";

type Plan = "starter" | "pro" | "scale";

const plans: Array<{
  key: Plan;
  name: string;
  price: string;
  calls: string;
}> = [
  {
    key: "starter",
    name: "Starter",
    price: "A$9/mo",
    calls: "200 calls / month",
  },
  {
    key: "pro",
    name: "Pro",
    price: "A$29/mo",
    calls: "1,000 calls / month",
  },
  {
    key: "scale",
    name: "Scale",
    price: "A$99/mo",
    calls: "5,000 calls / month",
  },
];

export default function PricingButtons() {
  const [loadingPlan, setLoadingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string>("");

  async function startCheckout(plan: Plan) {
    try {
      setLoadingPlan(plan);
      setError("");

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const data = await res.json();

      if (!res.ok || !data?.url) {
        setError("Unable to start checkout right now.");
        setLoadingPlan(null);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("[START_CHECKOUT_ERROR]", err);
      setError("Something went wrong starting checkout.");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isLoading = loadingPlan === plan.key;

          return (
            <div
              key={plan.key}
              className="rounded-2xl border border-white/10 p-5 text-left bg-white/[0.02]"
            >
              <div className="mb-3">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                <p className="text-white/70">{plan.price}</p>
                <p className="text-sm text-white/40">{plan.calls}</p>
              </div>

              <button
                onClick={() => startCheckout(plan.key)}
                disabled={loadingPlan !== null}
                className="w-full bg-white text-black font-medium px-4 py-3 rounded-full hover:bg-white/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? "Redirecting..." : `Choose ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <p className="text-white/40 text-sm">
        Sandbox checkout is enabled first for safe testing. Live billing comes after validation.
      </p>
    </div>
  );
}