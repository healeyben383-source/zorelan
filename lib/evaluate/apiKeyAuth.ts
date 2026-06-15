/**
 * lib/evaluate/apiKeyAuth.ts
 *
 * Minimal, reusable API-key auth + usage accounting for public v1 endpoints.
 * Mirrors the semantics already used by app/api/decision/route.ts (master key,
 * per-customer Redis key records, plan call limits, optional Upstash rate
 * limiting) without modifying or importing that route.
 *
 * Two-phase by design so a malformed request never burns a customer's quota:
 *   1) authorizeRequest()  — validate key, status, limit, rate limits. No write.
 *   2) accountUsage()      — increment callsUsed AFTER the body validates.
 *
 * Fails closed: customer keys require Redis; if Redis is unconfigured, customer
 * keys are rejected (only the master key works without Redis). API keys are
 * never echoed back; only hashed values are used in rate-limit keys.
 */

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import crypto from "crypto";
import type { UsageMeta } from "./types";

export type ApiKeyRecord = {
  email?: string | null;
  plan: string;
  callsLimit: number;
  callsUsed: number;
  customerId?: string;
  subscriptionId?: string;
  status?: "active" | "inactive";
  createdAt?: number;
};

export type AuthorizeResult =
  | { ok: true; isMaster: true }
  | { ok: true; isMaster: false; token: string; record: ApiKeyRecord }
  | {
      ok: false;
      status: number;
      error: string;
      scope?: "ip" | "api_key";
      retryAfter?: number;
      extra?: Record<string, unknown>;
    };

const ENABLE_API_RATE_LIMIT = process.env.ENABLE_API_RATE_LIMIT === "true";

let cachedRedis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (cachedRedis !== undefined) return cachedRedis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  cachedRedis = url && token ? new Redis({ url, token }) : null;
  return cachedRedis;
}

let cachedLimiters:
  | { ip: Ratelimit; key: Ratelimit }
  | undefined;
function getRateLimiters(redis: Redis): { ip: Ratelimit; key: Ratelimit } {
  if (cachedLimiters) return cachedLimiters;
  cachedLimiters = {
    key: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(10, "10 s"),
      analytics: true,
      timeout: 1000,
    }),
    ip: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(30, "10 s"),
      analytics: true,
      timeout: 1000,
    }),
  };
  return cachedLimiters;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

function hashKey(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function getRetryAfterSeconds(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000));
}

export function parseApiKeyRecord(input: unknown): ApiKeyRecord | null {
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

/**
 * Phase 1 — authorize without mutating usage. Validates the bearer key, applies
 * optional rate limiting, and confirms the customer key is active and under its
 * monthly limit. Does NOT increment usage (call accountUsage after the body
 * validates).
 */
export async function authorizeRequest(req: Request): Promise<AuthorizeResult> {
  const token = extractBearerToken(req);
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const redis = getRedis();
  const masterKey = process.env.DECISION_API_KEY;
  const isMaster = !!masterKey && token === masterKey;

  // IP rate limit (best-effort; only when enabled and Redis is available).
  if (ENABLE_API_RATE_LIMIT && redis) {
    const { ip } = getRateLimiters(redis);
    const ipResult = await ip.limit(`rl:ip:${getClientIp(req)}`);
    if (!ipResult.success) {
      return {
        ok: false,
        status: 429,
        error: "too_many_requests",
        scope: "ip",
        retryAfter: getRetryAfterSeconds(ipResult.reset),
      };
    }
  }

  if (isMaster) {
    if (ENABLE_API_RATE_LIMIT && redis) {
      const { key } = getRateLimiters(redis);
      const keyResult = await key.limit(`rl:key:${hashKey(token)}`);
      if (!keyResult.success) {
        return {
          ok: false,
          status: 429,
          error: "too_many_requests",
          scope: "api_key",
          retryAfter: getRetryAfterSeconds(keyResult.reset),
        };
      }
    }
    return { ok: true, isMaster: true };
  }

  // Customer key path requires Redis. Fail closed if it is unavailable.
  if (!redis) return { ok: false, status: 401, error: "unauthorized" };

  const record = parseApiKeyRecord(await redis.get(`apikey:${token}`));
  if (!record) return { ok: false, status: 401, error: "unauthorized" };

  if (ENABLE_API_RATE_LIMIT) {
    const { key } = getRateLimiters(redis);
    const keyResult = await key.limit(`rl:key:${hashKey(token)}`);
    if (!keyResult.success) {
      return {
        ok: false,
        status: 429,
        error: "too_many_requests",
        scope: "api_key",
        retryAfter: getRetryAfterSeconds(keyResult.reset),
      };
    }
  }

  const status = record.status ?? "active";
  if (status !== "active") {
    return { ok: false, status: 403, error: "subscription_inactive" };
  }

  if (record.callsUsed >= record.callsLimit) {
    return {
      ok: false,
      status: 429,
      error: "rate_limit_exceeded",
      extra: {
        plan: record.plan,
        calls_limit: record.callsLimit,
        calls_used: record.callsUsed,
        calls_remaining: 0,
        status,
      },
    };
  }

  return { ok: true, isMaster: false, token, record };
}

/**
 * Phase 2 — increment usage for a customer key and return usage meta. Call only
 * after the request body has validated. No-op semantics for master key (handled
 * by the caller passing isMaster). Returns null if the write fails (treated as
 * unmetered rather than blocking a valid request).
 */
export async function accountUsage(
  token: string,
  record: ApiKeyRecord
): Promise<UsageMeta | null> {
  const redis = getRedis();
  if (!redis) return null;

  const status = record.status ?? "active";
  const updated: ApiKeyRecord = {
    ...record,
    status,
    callsUsed: record.callsUsed + 1,
  };

  try {
    await redis.set(`apikey:${token}`, JSON.stringify(updated));
  } catch {
    return null;
  }

  return {
    plan: updated.plan,
    callsLimit: updated.callsLimit,
    callsUsed: updated.callsUsed,
    callsRemaining: Math.max(0, updated.callsLimit - updated.callsUsed),
    status: updated.status ?? "active",
  };
}
