import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 }
  );
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return unauthorized();
    const token = authHeader.slice(7).trim();
    if (token !== process.env.DECISION_API_KEY) return unauthorized();

    const [total, triggered, changed, confirmed] = await Promise.all([
      redis.get("zorelan:analytics:arbitration:total"),
      redis.get("zorelan:analytics:arbitration:triggered"),
      redis.get("zorelan:analytics:arbitration:changed"),
      redis.get("zorelan:analytics:arbitration:confirmed"),
    ]);

    return NextResponse.json({
      ok: true,
      analytics: {
        total: Number(total ?? 0),
        triggered: Number(triggered ?? 0),
        changed: Number(changed ?? 0),
        confirmed: Number(confirmed ?? 0),
      },
    });
  } catch (err) {
    console.error("[/api/analytics] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}