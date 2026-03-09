import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const PLAN_LIMITS: Record<string, number> = {
  starter: 200,
  pro: 1000,
  scale: 5000,
};

const PRICE_TO_PLAN: Record<string, string> = {
  [process.env.STRIPE_PRICE_STARTER!]: "starter",
  [process.env.STRIPE_PRICE_PRO!]: "pro",
  [process.env.STRIPE_PRICE_SCALE!]: "scale",
};

function generateApiKey(): string {
  return "zrl_live_" + crypto.randomBytes(24).toString("base64url");
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("[WEBHOOK] signature verification failed:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    const email = session.customer_details?.email;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    // Get the subscription to find the price ID
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = subscription.items.data[0]?.price.id;
    const plan = PRICE_TO_PLAN[priceId] ?? "starter";
    const callsLimit = PLAN_LIMITS[plan] ?? 200;

    // Generate API key
    const apiKey = generateApiKey();

    // Store in Redis
    await redis.set(`apikey:${apiKey}`, JSON.stringify({
      email,
      plan,
      callsLimit,
      callsUsed: 0,
      customerId,
      subscriptionId,
      createdAt: Date.now(),
    }));

    // Also store a lookup by customer ID
    await redis.set(`customer:${customerId}:apikey`, apiKey);

    console.log(`[WEBHOOK] API key created for ${email} on ${plan} plan`);
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    // Find and delete their API key
    const apiKey = await redis.get<string>(`customer:${customerId}:apikey`);
    if (apiKey) {
      await redis.del(`apikey:${apiKey}`);
      await redis.del(`customer:${customerId}:apikey`);
      console.log(`[WEBHOOK] API key revoked for customer ${customerId}`);
    }
  }

  return NextResponse.json({ ok: true });
}