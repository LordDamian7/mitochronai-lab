import { currentUser } from "@/lib/auth";
import { auditCsv } from "@/lib/auditlog";

export const dynamic = "force-dynamic";

/** CSV export of the audit log: chief scientist and administrators only; the export itself is audited. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new Response("Sign in first", { status: 401 });
  if (me.must_change_password) return new Response("Choose your own password first", { status: 403 });
  const p = new URL(req.url).searchParams, get = (k: string) => p.get(k) ?? undefined;
  const r = auditCsv(me, { from: get("from"), to: get("to"), actor: get("actor"), action: get("action"), q: get("q") });
  if (!r.ok) return new Response(r.reason, { status: 403 });
  const day = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  // UTF-8 BOM so Excel shows ₦ and accented names correctly.
  return new Response("﻿" + r.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mitochronai-audit-${day}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
