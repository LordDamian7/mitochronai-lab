"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Ev = { kind: string; orderId?: string; by?: string; at: string };
const MESSAGES: Record<string, string> = {
  "report.approved": "approved and sent a report",
  "report.previewed": "opened a report preview",
  "report.drafted": "Gaya drafted a report",
};

/** Listens to the lab's change feed and refreshes this page when someone else changes something. */
export default function LiveUpdates({ me }: { me: string }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "open" | "closed">("connecting");
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const n = useRef(0);
  useEffect(() => {
    const es = new EventSource("/api/events");
    // Changes made while the feed was connecting or reconnecting are never replayed, so catch up once on every (re)connect.
    es.onopen = () => { setState("open"); router.refresh(); };
    es.onerror = () => setState("closed");
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as Ev;
      // Our own actions already navigate to the updated page; refreshing on top of that cuts off the page's data stream.
      if (e.by !== me) router.refresh();
      if (e.by && e.by !== me && MESSAGES[e.kind]) {
        const id = ++n.current;
        setToasts((t) => [...t, { id, text: `${e.by} ${MESSAGES[e.kind]}` }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
      }
    };
    return () => es.close();
  }, [router, me]);
  return (
    <>
      <span className="live" data-state={state} title="Updates from other users appear without reloading">
        <i aria-hidden="true" />{state === "open" ? "Live" : state === "connecting" ? "Connecting…" : "Reconnecting…"}
      </span>
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </>
  );
}
