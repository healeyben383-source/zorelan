import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import crypto from "crypto";

export const runtime = "nodejs";

const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const redis = new Redis({ url: redisUrl, token: redisToken });

// ─── Schemas ──────────────────────────────────────────────────────────────────

const FeedbackRequestSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  verdict: z.string().min(1).max(5_000),
  issue: z.enum([
    "incorrect_verdict",
    "wrong_agreement_level",
    "missing_nuance",
    "other",
  ]),
  correct_answer: z.string().min(1).max(5_000),
  request_id: z.string().max(200).optional(),
  notes: z.string().max(2_000).optional(),
});

const FeedbackRecordSchema = FeedbackRequestSchema.extend({
  id: z.string(),
  submittedAt: z.number(),
  submittedBy: z.enum(["api_key", "master_key"]),
});

type FeedbackRecord = z.infer<typeof FeedbackRecordSchema>;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function extractBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 }
  );
}

async function isValidApiKey(token: string): Promise<boolean> {
  try {
    const raw = await redis.get(`apikey:${token}`);
    if (!raw) return false;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return (
      parsed &&
      typeof parsed === "object" &&
      (parsed.status === "active" || parsed.status === undefined)
    );
  } catch {
    return false;
  }
}

// ─── POST /api/feedback ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return unauthorized();

    const isMasterKey = token === process.env.DECISION_API_KEY;

    let submittedBy: "api_key" | "master_key";

    if (isMasterKey) {
      submittedBy = "master_key";
    } else {
      const valid = await isValidApiKey(token);
      if (!valid) return unauthorized();
      submittedBy = "api_key";
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "invalid_json" },
        { status: 400 }
      );
    }

    const parsed = FeedbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "validation_failed",
          issues: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();
    const submittedAt = Date.now();

    const record: FeedbackRecord = {
      id,
      submittedAt,
      submittedBy,
      ...parsed.data,
    };

    // Store with timestamp-based key for easy listing
    const key = `feedback:${submittedAt}:${id}`;
    await redis.set(key, JSON.stringify(record));

    // Keep an index of all feedback keys for fast listing
    await redis.lpush("feedback:index", key);

    console.log("[FEEDBACK_SUBMITTED]", JSON.stringify({
      id,
      issue: record.issue,
      submittedBy,
      promptLength: record.prompt.length,
    }));

    return NextResponse.json({
      ok: true,
      id,
      message: "Feedback received. Thank you.",
    });
  } catch (err) {
    console.error("[/api/feedback] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}

// ─── GET /api/feedback ────────────────────────────────────────────────────────
// Master key only — returns all feedback records

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req);
    if (!token) return unauthorized();

    const isMasterKey = token === process.env.DECISION_API_KEY;
    if (!isMasterKey) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403 }
      );
    }

    // Get all keys from index
    const keys = await redis.lrange("feedback:index", 0, -1);

    if (!keys || keys.length === 0) {
      return NextResponse.json({ ok: true, feedback: [], total: 0 });
    }

    // Fetch all records
    const records = await Promise.all(
      keys.map(async (key) => {
        try {
          const raw = await redis.get(key as string);
          if (!raw) return null;
          return typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
    );

    const feedback = records
      .filter((r): r is FeedbackRecord => r !== null)
      .sort((a, b) => b.submittedAt - a.submittedAt);

    return NextResponse.json({
      ok: true,
      feedback,
      total: feedback.length,
    });
  } catch (err) {
    console.error("[/api/feedback] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}