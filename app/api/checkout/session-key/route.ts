import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const stripe = new Stripe(stripeSecretKey);
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
      typeof parsed.callsLimit !== "number"
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
    const sessionId = req.nextUrl.searchParams.get("session_id");

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing_session_id" },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "session_not_found" },
        { status: 404 }
      );
    }

    if (session.status !== "complete") {
      return NextResponse.json(
        { ok: false, error: "checkout_not_completed" },
        { status: 400 }
      );
    }

    const apiKey = await redis.get<string>(`checkout_session:${sessionId}:apikey`);

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "pending_key_generation" },
        { status: 404 }
      );
    }

    const rawRecord = await redis.get(`apikey:${apiKey}`);
    const record = parseApiKeyRecord(rawRecord);

    if (!record) {
      return NextResponse.json(
        { ok: false, error: "api_key_not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      apiKey,
      plan: record.plan,
      callsLimit: record.callsLimit,
      email: record.email ?? null,
    });
  } catch (error) {
    console.error("[CHECKOUT_SESSION_KEY_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}