import { currentUser } from "@/lib/auth";
import { bus, type LabEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/** Server-sent events: each signed-in browser hears about changes made by anyone in the lab. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return new Response("Sign in first", { status: 401 });
  if (me.must_change_password) return new Response("Choose your own password first", { status: 403 });
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LabEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      const ping = setInterval(() => controller.enqueue(enc.encode(": ping\n\n")), 25000);
      bus.on("change", send);
      controller.enqueue(enc.encode("retry: 3000\n\n"));
      cleanup = () => { clearInterval(ping); bus.off("change", send); };
      req.signal.addEventListener("abort", () => { cleanup(); try { controller.close(); } catch {} });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
