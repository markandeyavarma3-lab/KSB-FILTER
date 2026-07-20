import { NextRequest, NextResponse } from "next/server";
import { search } from "@/db/engine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = await req.json();
  const nums = ["flowMinLph", "flowMaxLph", "depthMinFt", "depthMaxFt"] as const;
  for (const k of nums) {
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v <= 0) {
      return NextResponse.json({ error: `Invalid ${k}: must be a positive number` }, { status: 400 });
    }
  }
  if (Number(b.flowMaxLph) < Number(b.flowMinLph)) {
    return NextResponse.json({ error: "Max flow must be ≥ min flow" }, { status: 400 });
  }
  if (Number(b.depthMaxFt) < Number(b.depthMinFt)) {
    return NextResponse.json({ error: "Max depth must be ≥ min depth" }, { status: 400 });
  }
  const result = search({
    flowMinLph: Number(b.flowMinLph), flowMaxLph: Number(b.flowMaxLph),
    depthMinFt: Number(b.depthMinFt), depthMaxFt: Number(b.depthMaxFt),
    nearTolerancePct: b.nearTolerancePct != null ? Number(b.nearTolerancePct) : 5,
    ranking: b.ranking ?? "balanced",
  });
  return NextResponse.json(result);
}
