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
  let hpMin: number | null = null, hpMax: number | null = null;
  if (b.hpMin !== "" && b.hpMin != null) {
    hpMin = Number(b.hpMin);
    if (!Number.isFinite(hpMin) || hpMin <= 0) {
      return NextResponse.json({ error: "Invalid hpMin: must be a positive number" }, { status: 400 });
    }
  }
  if (b.hpMax !== "" && b.hpMax != null) {
    hpMax = Number(b.hpMax);
    if (!Number.isFinite(hpMax) || hpMax <= 0) {
      return NextResponse.json({ error: "Invalid hpMax: must be a positive number" }, { status: 400 });
    }
  }
  if (hpMin != null && hpMax != null && hpMax < hpMin) {
    return NextResponse.json({ error: "Max HP must be ≥ min HP" }, { status: 400 });
  }
  const result = search({
    flowMinLph: Number(b.flowMinLph), flowMaxLph: Number(b.flowMaxLph),
    depthMinFt: Number(b.depthMinFt), depthMaxFt: Number(b.depthMaxFt),
    hpMin, hpMax,
    nearTolerancePct: b.nearTolerancePct != null ? Number(b.nearTolerancePct) : 5,
    ranking: b.ranking ?? "balanced",
  });
  return NextResponse.json(result);
}
