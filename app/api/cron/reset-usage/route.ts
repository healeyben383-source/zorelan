import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;
const cronSecret = process.env.CRON_SECRET;

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

type ApiKeyRecord = {
  email?: string | null;
  plan: string;
  callsLimit: number;
  callsUsed: number;
  customerId?: string;
  subscriptionId?: string;
  createdAt?: number;
};

function parseApiKeyRecord(input: unknown): ApiKeyRecord | null {
  try {
    const parsed =
      typeof input === "string" ? JSON.parse(input) : (input as ApiKeyRecord);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.plan !== "string" ||
      typeof parsed.callsLimit !== "number" ||
      typeof parsed.callsUsed !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const expected = cronSecret ? `Bearer ${cronSecret}` : null;

    if (expected && authHeader !== expected) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const keys = await redis.keys("apikey:*");

    let resetCount = 0;

    for (const redisKey of keys) {
      const raw = await redis.get(redisKey);
      const parsed = parseApiKeyRecord(raw);

      if (!parsed) continue;

      await redis.set(
        redisKey,
        JSON.stringify({
          ...parsed,
          callsUsed: 0,
        })
      );

      resetCount += 1;
    }

    return NextResponse.json({
      ok: true,
      resetCount,
    });
  } catch (error) {
    console.error("[RESET_USAGE_CRON_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}