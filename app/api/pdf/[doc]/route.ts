import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Serves the source PDFs locally so the source viewer can open the exact page
// via the native viewer's #page=N anchor. Local-first: never leaves the machine.
const FILES: Record<string, string> = {
  technical: "Selection Chart Agri.pdf",
  price: "Confidential Price 1-7-2026 Secunderabad Branch Final.pdf",
};

export async function GET(_req: NextRequest, { params }: { params: { doc: string } }) {
  const file = FILES[params.doc];
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const buf = readFileSync(join(process.cwd(), "source_pdfs", file));
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${file}"` },
    });
  } catch {
    return new Response("File missing", { status: 404 });
  }
}
