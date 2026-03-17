import { NextResponse } from "next/server";
import { zorelan } from "@/lib/zorelanClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = await zorelan.verify("Is Earth a planet?");

    return NextResponse.json({
      ok: true,
      answer: result.verified_answer,
      trust: result.trust_score.score,
      consensus: result.consensus.level,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}