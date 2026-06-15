/**
 * app/api/admin/customers/route.ts
 *
 * Master-key-protected operational visibility into issued API keys / customers.
 * Read-only. Returns SANITIZED records only — never the full API key (prefix
 * only). Reuses the existing Redis `apikey:*` records written by the Stripe
 * webhook; builds no accounts/login system.
 *
 * Auth: Bearer DECISION_API_KEY (the same master key used by /api/feedback GET).
 * Resilience: Redis is constructed lazily and missing env returns a JSON error
 * instead of throwing at module evaluation (so the admin UI can show useful text).
 */

import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

// Safety cap so a large key space can't produce an unbounded response.
const MAX_KEYS = 1000;

let cachedRedis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

type ApiKeyRecord = {
  email?: string | null;
  plan?: string;
  callsLimit?: number;
  callsUsed?: number;
  customerId?: string;
  subscriptionId?: string;
  status?: "active" | "inactive";
  createdAt?: number;
};

function parseRecord(input: unknown): ApiKeyRecord | null {
  try {
    const parsed =
      typeof input === "string" ? JSON.parse(input) : (input as ApiKeyRecord);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ApiKeyRecord;
  } catch {
    return null;
  }
}

/** Show only a short, non-reconstructable prefix of the key. */
function keyPrefixFromRedisKey(redisKey: string): string {
  const raw = redisKey.startsWith("apikey:") ? redisKey.slice(7) : redisKey;
  return `${raw.slice(0, 12)}…`;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return unauthorized();
  const token = authHeader.slice(7).trim();

  const masterKey = process.env.DECISION_API_KEY;
  if (!masterKey || token !== masterKey) return unauthorized();

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { ok: false, error: "redis_unavailable" },
      { status: 503 }
    );
  }

  try {
    const allKeys = await redis.keys("apikey:*");
    const truncated = allKeys.length > MAX_KEYS;
    const keys = truncated ? allKeys.slice(0, MAX_KEYS) : allKeys;

    const raws = await Promise.all(keys.map((k) => redis.get(k)));

    const customers = keys
      .map((redisKey, i) => {
        const record = parseRecord(raws[i]);
        if (!record) return null;
        return {
          api_key_prefix: keyPrefixFromRedisKey(redisKey),
          email: record.email ?? null,
          plan: record.plan ?? null,
          status: record.status ?? "active",
          calls_used: record.callsUsed ?? null,
          calls_limit: record.callsLimit ?? null,
          calls_remaining:
            typeof record.callsLimit === "number" &&
            typeof record.callsUsed === "number"
              ? Math.max(0, record.callsLimit - record.callsUsed)
              : null,
          created_at: record.createdAt ?? null,
          customer_id: record.customerId ?? null,
          subscription_id: record.subscriptionId ?? null,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0));

    return NextResponse.json({
      ok: true,
      total: customers.length,
      truncated,
      customers,
    });
  } catch (err) {
    console.error("[/api/admin/customers] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
