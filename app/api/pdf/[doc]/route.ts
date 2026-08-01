import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Serves the source PDFs locally so the source viewer can open the exact page
// via the native viewer's #page=N anchor. Local-first: never leaves the machine.
const FILES: Record<string, string> = {
  technical: "Selection Chart Agri.pdf",
  price: "Confidential Price 1-7-2026 Secunderabad Branch Final.pdf",
};

// The price booklet is confidential (spec section 48). The server binds to
// 127.0.0.1 by default, but bind settings are easy to change by accident, so the
// confidential document is additionally gated here: it is served only to
// loopback callers unless LAN access was opted into explicitly.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function isLocalRequest(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return LOOPBACK.has(host);
}

export async function GET(req: NextRequest, { params }: { params: { doc: string } }) {
  const file = FILES[params.doc];
  if (!file) return new Response("Not found", { status: 404 });
  if (params.doc === "price" && !isLocalRequest(req) && process.env.KSB_ALLOW_LAN !== "1") {
    return new Response(
      "The confidential price list is only served on this computer. Open the app at http://localhost:3000.",
      { status: 403 },
    );
  }
  try {
    const buf = readFileSync(join(process.cwd(), "source_pdfs", file));
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}"` },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
