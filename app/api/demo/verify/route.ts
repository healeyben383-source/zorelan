export const runtime = "nodejs";

type Risk = "low" | "moderate" | "high";
type Decision = "SEND" | "REVIEW" | "BLOCK";

interface ZorelanResponse {
  trust_score: { score: number };
  risk_level: Risk;
  verified_answer: string;
  shared_conclusion?: string;
  verdict?: string;
  key_disagreement: string;
  decision_rule?: string;
  recommended_action?: string;
  consensus: { level: "high" | "medium" | "low" };
}

function deriveDecision(
  trust: number,
  risk: Risk,
  raw_prompt: string
): { decision: Decision; decision_reason: string | null } {
  const prompt = raw_prompt.toLowerCase();

  // Financial action without verified context — override before trust/risk scoring
  const hasFinancialAction = /refund|refunding|reimburse|payment/.test(prompt);
  const hasUnverifiedContext = /not confirmed|not verified|no confirmation|not received|haven.t confirmed|haven.t verified/.test(prompt);

  if (hasFinancialAction && hasUnverifiedContext) {
    return {
      decision: "BLOCK",
      decision_reason:
        "This response initiates a financial action without verified context. Acting on it introduces financial and fraud risk."
    };
  }

  if (risk === "high") return { decision: "BLOCK", decision_reason: null };
  if (risk === "moderate") return { decision: "REVIEW", decision_reason: null };
  if (risk === "low" && trust >= 70) {
    return {
      decision: "SEND",
      decision_reason: "Low-risk response with strong agreement. Safe to execute."
    };
  }
  return { decision: "REVIEW", decision_reason: null };
}

function fallbackResponse() {
  return Response.json({
    trust: 62,
    risk: "moderate" as Risk,
    decision: "REVIEW" as Decision,
    verified_answer: null,
    shared_conclusion: "Fallback mock — Zorelan API unavailable",
    key_disagreement: null,
    decision_rule: null,
    consensus: null
  });
}

function getBaseUrl(): string {
  // Explicit override takes priority (set in .env.local for dev, Vercel env for prod)
  if (process.env.ZORELAN_BASE_URL) return process.env.ZORELAN_BASE_URL;
  // Vercel automatically sets VERCEL_URL on every deployment
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  // Local development fallback
  return "http://localhost:3000";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { draft, raw_prompt } = body;

  if (!draft || typeof draft !== "string") {
    return Response.json({ error: "Missing or invalid draft" }, { status: 400 });
  }

  const requestBody = { prompt: draft, raw_prompt: raw_prompt ?? "" };
  const baseUrl = getBaseUrl();
  console.log("[demo/verify] Sending to /api/decision:", JSON.stringify(requestBody));

  try {
    const zorelanRes = await fetch(`${baseUrl}/api/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DECISION_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    console.log("[demo/verify] Response status:", zorelanRes.status);

    if (!zorelanRes.ok) {
      const errorText = await zorelanRes.text();
      console.error("[demo/verify] Non-OK response. Status:", zorelanRes.status, "Body:", errorText);
      return fallbackResponse();
    }

    const rawText = await zorelanRes.text();
    console.log("[demo/verify] Raw response body:", rawText);

    let data: ZorelanResponse;
    try {
      data = JSON.parse(rawText);
    } catch (parseError) {
      console.error("[demo/verify] Failed to parse response as JSON:", parseError);
      return fallbackResponse();
    }

    console.log("[demo/verify] Parsed trust_score:", data.trust_score, "risk_level:", data.risk_level);

    const trust = data.trust_score?.score ?? 0;

    // Informational support queries carry no financial or account risk — classify as low.
    const prompt = (raw_prompt ?? "").toLowerCase();
    const isInformational =
      /tracking\s*number|order\s*status|confirmation\s*email|where\s*can\s*i\s*find/.test(prompt);
    const risk: Risk = isInformational ? "low" : (data.risk_level ?? "high");

    const { decision, decision_reason } = deriveDecision(trust, risk, raw_prompt ?? "");

    return Response.json({
      trust,
      risk,
      decision,
      decision_reason,
      verified_answer: data.verified_answer ?? null,
      shared_conclusion: data.shared_conclusion ?? data.verdict ?? null,
      key_disagreement: data.key_disagreement ?? null,
      decision_rule: data.decision_rule ?? data.recommended_action ?? null,
      consensus: data.consensus?.level ?? null
    });
  } catch (error) {
    console.error("[demo/verify] Fetch threw an exception — likely ECONNREFUSED or network error:", error);
    return fallbackResponse();
  }
}
