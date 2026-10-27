"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Sends the chosen .mlup file to /api/update/upload, then shows the result on the update page. */
export default function UploadUpdate() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <form className="panel-body" onSubmit={async (e) => {
      e.preventDefault();
      const file = (e.currentTarget.elements.namedItem("package") as HTMLInputElement).files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const res = await fetch("/api/update/upload", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
        const r = await res.json().catch(() => ({ ok: false, reason: "The app didn't answer properly. Try again." }));
        router.push(r.ok ? "/update?staged=1" : `/update?error=${encodeURIComponent(r.reason)}`);
        router.refresh();
      } finally { setBusy(false); }
    }}>
      <label className="field" htmlFor="package">Update file (.mlup)<input id="package" name="package" type="file" accept=".mlup" required /></label>
      <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Check the package"}</button></div>
    </form>
  );
}
