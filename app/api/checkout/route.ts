import { NextResponse } from "next/server";
import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(stripeSecretKey);

const PRICE_MAP: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  scale: process.env.STRIPE_PRICE_SCALE,
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const plan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";

    const priceId = PRICE_MAP[plan];

    if (!priceId) {
      return NextResponse.json(
        { ok: false, error: "invalid_plan" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://zorelan.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/api-docs?checkout=success`,
      cancel_url: `${appUrl}/api-docs?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return NextResponse.json(
        { ok: false, error: "missing_checkout_url" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    console.error("[STRIPE_CHECKOUT_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: "checkout_error" },
      { status: 500 }
    );
  }
}