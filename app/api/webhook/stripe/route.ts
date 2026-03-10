import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { Redis } from "@upstash/redis";
import crypto from "crypto";
import { Resend } from "resend";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;
const redisUrl = process.env.KV_REST_API_URL;
const redisToken = process.env.KV_REST_API_TOKEN;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

if (!webhookSecret) {
  throw new Error("Missing STRIPE_WEBHOOK_SECRET");
}

if (!redisUrl || !redisToken) {
  throw new Error("Missing Upstash Redis environment variables");
}

const stripe = new Stripe(stripeSecretKey);
const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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

type ApiKeyRecord = {
  email?: string | null;
  plan: string;
  callsLimit: number;
  callsUsed: number;
  customerId?: string;
  subscriptionId?: string;
  status?: "active" | "inactive";
  createdAt?: number;
};

function generateApiKey(): string {
  return "zrl_live_" + crypto.randomBytes(24).toString("base64url");
}

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

async function updateApiKeyStatusByCustomerOrSubscription({
  customerId,
  subscriptionId,
  status,
}: {
  customerId?: string | null;
  subscriptionId?: string | null;
  status: "active" | "inactive";
}) {
  const apiKey =
    (subscriptionId
      ? await redis.get<string>(`subscription:${subscriptionId}:apikey`)
      : null) ||
    (customerId ? await redis.get<string>(`customer:${customerId}:apikey`) : null);

  if (!apiKey) {
    console.log(
      `[WEBHOOK] no API key found for customer=${customerId ?? "none"} subscription=${
        subscriptionId ?? "none"
      }`
    );
    return;
  }

  const raw = await redis.get(`apikey:${apiKey}`);
  const parsed = parseApiKeyRecord(raw);

  if (!parsed) {
    console.log(`[WEBHOOK] invalid API key record for ${apiKey}`);
    return;
  }

  const updatedRecord: ApiKeyRecord = {
    ...parsed,
    status,
  };

  await redis.set(`apikey:${apiKey}`, JSON.stringify(updatedRecord));

  console.log(`[WEBHOOK] API key ${apiKey} marked ${status}`);
}

async function sendApiKeyEmail({
  email,
  apiKey,
  plan,
  callsLimit,
}: {
  email: string;
  apiKey: string;
  plan: string;
  callsLimit: number;
}) {
  if (!resend) {
    console.log("[WEBHOOK] RESEND_API_KEY not set, skipping email send");
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://zorelan.com";

  try {
    await resend.emails.send({
      from: "Zorelan <onboarding@zorelan.com>",
      to: email,
      subject: "Your Zorelan API key",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>Your Zorelan API key is ready</h2>
          <p>Thanks for subscribing to Zorelan.</p>
          <p><strong>Plan:</strong> ${plan}</p>
          <p><strong>Monthly limit:</strong> ${callsLimit}</p>
          <p><strong>API key:</strong></p>
          <pre style="padding:12px;background:#f4f4f4;border-radius:6px;overflow:auto;">${apiKey}</pre>
          <p>Example request:</p>
          <pre style="padding:12px;background:#f4f4f4;border-radius:6px;overflow:auto;">curl -X POST "${appUrl}/v1/decision" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"Should I hire staff or stay solo?"}'</pre>
          <p>Docs: <a href="${appUrl}/api-docs">${appUrl}/api-docs</a></p>
        </div>
      `,
    });

    console.log(`[WEBHOOK] API key email sent to ${email}`);
  } catch (error) {
    console.error("[WEBHOOK] failed to send API key email:", error);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("[WEBHOOK] signature verification failed:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const email = session.customer_details?.email ?? null;
      const customerId = session.customer as string | null;
      const subscriptionId = session.subscription as string | null;
      const sessionId = session.id;

      if (!customerId || !subscriptionId) {
        console.error("[WEBHOOK] missing customerId or subscriptionId");
        return NextResponse.json(
          { error: "missing_customer_or_subscription" },
          { status: 400 }
        );
      }

      const existingApiKey = await redis.get<string>(
        `customer:${customerId}:apikey`
      );

      if (existingApiKey) {
        await redis.set(`checkout_session:${sessionId}:apikey`, existingApiKey, {
          ex: 60 * 60 * 24,
        });

        await updateApiKeyStatusByCustomerOrSubscription({
          customerId,
          subscriptionId,
          status: "active",
        });

        console.log(
          `[WEBHOOK] existing API key already present for customer ${customerId}`
        );
        return NextResponse.json({ ok: true });
      }

      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = PRICE_TO_PLAN[priceId] ?? "starter";
      const callsLimit = PLAN_LIMITS[plan] ?? 200;

      const apiKey = generateApiKey();

      const keyPayload: ApiKeyRecord = {
        email,
        plan,
        callsLimit,
        callsUsed: 0,
        customerId,
        subscriptionId,
        status: "active",
        createdAt: Date.now(),
      };

      await redis.set(`apikey:${apiKey}`, JSON.stringify(keyPayload));
      await redis.set(`customer:${customerId}:apikey`, apiKey);
      await redis.set(`subscription:${subscriptionId}:apikey`, apiKey);
      await redis.set(`checkout_session:${sessionId}:apikey`, apiKey, {
        ex: 60 * 60 * 24,
      });

      console.log(`[WEBHOOK] API key created for ${email} on ${plan} plan`);

      if (email) {
        await sendApiKeyEmail({
          email,
          apiKey,
          plan,
          callsLimit,
        });
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string | null;
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : null;

      await updateApiKeyStatusByCustomerOrSubscription({
        customerId,
        subscriptionId,
        status: "inactive",
      });

      console.log(
        `[WEBHOOK] payment failed; API key marked inactive for customer ${customerId}`
      );
    }

    if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object as any;
      const customerId = invoice.customer as string | null;
      const subscriptionId =
        typeof invoice.subscription === "string" ? invoice.subscription : null;

      await updateApiKeyStatusByCustomerOrSubscription({
        customerId,
        subscriptionId,
        status: "active",
      });

      console.log(
        `[WEBHOOK] payment succeeded; API key marked active for customer ${customerId}`
      );
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const subscriptionId = subscription.id;

      const apiKey =
        (await redis.get<string>(`subscription:${subscriptionId}:apikey`)) ||
        (await redis.get<string>(`customer:${customerId}:apikey`));

      if (apiKey) {
        await redis.del(`apikey:${apiKey}`);
      }

      await redis.del(`customer:${customerId}:apikey`);
      await redis.del(`subscription:${subscriptionId}:apikey`);

      console.log(`[WEBHOOK] API key revoked for customer ${customerId}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[WEBHOOK] handler failed:", error);
    return NextResponse.json({ error: "webhook_handler_failed" }, { status: 500 });
  }
}