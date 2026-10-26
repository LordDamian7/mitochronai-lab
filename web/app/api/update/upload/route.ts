import { currentUser } from "@/lib/auth";
import { LIMITS } from "@/lib/update";
import { stageUpdate } from "@/lib/updater";

export const dynamic = "force-dynamic";

/**
 * Upload of an update package. A dedicated endpoint (not a server action) so that only this route accepts large bodies:
 * who is calling is checked BEFORE a byte is read, the request must come from this site (CSRF), and reading stops at 25 MB.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me || me.must_change_password) return Response.json({ ok: false, reason: "Sign in first." }, { status: 401 });
  if (me.role !== "admin") return Response.json({ ok: false, reason: "Only the lab's administrator account can install updates." }, { status: 403 });
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, reason: "Refused: the request didn't come from this app." }, { status: 403 });
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > LIMITS.packedBytes) return Response.json({ ok: false, reason: "That file is too large to be an update package." }, { status: 413 });
  if (!req.body) return Response.json({ ok: false, reason: "No file received." }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > LIMITS.packedBytes) { await reader.cancel(); return Response.json({ ok: false, reason: "That file is too large to be an update package." }, { status: 413 }); }
    chunks.push(value);
  }
  const r = stageUpdate(Buffer.concat(chunks), me);
  return Response.json(r.ok ? { ok: true, version: r.version } : r, { status: r.ok ? 200 : 422 });
}
