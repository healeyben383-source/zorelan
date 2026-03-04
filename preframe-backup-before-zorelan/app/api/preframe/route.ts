// /app/api/preframe/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

// If you have a prompt builder, import it here.
// If not, this route will still work with the inline builder below.
// Example:
// import { buildPreframeMessages } from "@/lib/promptEngine";

export const runtime = "nodejs"; // OpenAI SDK expects Node runtime (not Edge)

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type PreframeRequest = {
  // Your UI can send any of these; we’ll accept a few common shapes.
  question?: string;
  raw?: string;
  input?: string;

  // Optional “category” / “mode” selector (you mentioned categories).
  category?: string;

  // Optional extra context from the user/app.
  context?: string;

  // Optional: tone, constraints, etc.
  constraints?: string;

  // Optional: allow passing pre-built messages
  // (handy if your frontend composes them).
  messages?: Array<{ role: "system" | "developer" | "user"; content: string }>;
};

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ?? {}) },
    { status }
  );
}

/**
 * Extract text robustly from a Responses API response.
 * `resp.output_text` is convenient but can be empty in some cases.
 */
function extractText(resp: any): string {
  const direct = (resp?.output_text ?? "").trim();
  if (direct) return direct;

  const output = Array.isArray(resp?.output) ? resp.output : [];
  for (const item of output) {
    // Typical structure: { type: "message", content: [{ type: "output_text", text: "..." }, ...] }
    if (item?.type === "message" && Array.isArray(item?.content)) {
      const parts = item.content
        .filter((c: any) => c?.type === "output_text" && typeof c?.text === "string")
        .map((c: any) => c.text);

      const joined = parts.join("\n").trim();
      if (joined) return joined;
    }
  }
  return "";
}

/**
 * Minimal prompt builder (safe fallback).
 * Replace with your real promptEngine if you have one.
 */
function buildMessages(req: PreframeRequest) {
  const userText =
    (req.question ?? req.raw ?? req.input ?? "").trim() ||
    "";

  // Category-aware framing if you’re using categories.
  const categoryLine = req.category ? `Category: ${req.category}` : "";
  const contextLine = req.context ? `Context: ${req.context}` : "";
  const constraintsLine = req.constraints ? `Constraints: ${req.constraints}` : "";

  const system = [
    "You are Preframe: rewrite the user's question into a clearer, higher-quality prompt they can paste into an AI.",
    "Output ONLY the improved prompt. No preamble, no bullet list unless it improves clarity, no commentary.",
    "Preserve the user's intent; do not add invented facts.",
  ].join(" ");

  const developer = [
    "Rewrite to be specific, actionable, and unambiguous.",
    "If important details are missing, include a short bracketed section with assumptions and a short list of targeted questions.",
    "Prefer structure: Goal / Constraints / Context / Output format.",
  ].join(" ");

  const user = [
    categoryLine,
    contextLine,
    constraintsLine,
    `User question: ${userText}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { system, developer, user, userText };
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return jsonError("server_misconfigured: missing OPENAI_API_KEY", 500);
    }

    const body = (await request.json().catch(() => null)) as PreframeRequest | null;
    if (!body) return jsonError("invalid_json");

    // If the client provides messages directly, trust them (lightly) but still validate.
    let inputMessages:
      | Array<{ role: "system" | "developer" | "user"; content: string }>
      | null = null;

    if (Array.isArray(body.messages) && body.messages.length) {
      const cleaned = body.messages
        .filter((m) => m && typeof m.content === "string" && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content.trim() }));
      if (cleaned.length) inputMessages = cleaned;
    }

    // Otherwise build from the request fields.
    const { system, developer, user, userText } = buildMessages(body);

    if (!inputMessages && !userText) {
      return jsonError("missing_input: provide question/raw/input", 400);
    }

    const input =
      inputMessages ??
      ([
        system && { role: "system" as const, content: system },
        developer && { role: "developer" as const, content: developer },
        { role: "user" as const, content: user },
      ].filter(Boolean) as Array<{ role: "system" | "developer" | "user"; content: string }>);

    // Call OpenAI Responses API
    const resp = await openai.responses.create({
      model: "gpt-5-mini",
      input,
      max_output_tokens: 1200, // avoid reasoning-only truncation
    });

    const text = extractText(resp);

    if (!text) {
      // Useful server-side debug without leaking internals to client
      console.log("[preframe] empty_output", {
        id: resp?.id,
        status: resp?.status,
        output_types: Array.isArray(resp?.output) ? resp.output.map((x: any) => x?.type) : null,
        usage: resp?.usage,
      });

      return jsonError("empty_output", 500);
    }

    return NextResponse.json({ ok: true, text });
  } catch (err: any) {
    console.error("[preframe] route_error", err);
    return jsonError("server_error", 500);
  }
}