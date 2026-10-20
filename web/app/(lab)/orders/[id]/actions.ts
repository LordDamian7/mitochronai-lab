"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { publish } from "@/lib/events";
import { approveAndSend } from "@/lib/lab";

/** "Approve and send": the server re-checks role, preview and Gaya's checks; the UI state is never trusted. */
export async function approveAction(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("orderId"));
  const back = String(formData.get("back") ?? `/orders/${id}`);
  const res = approveAndSend(id, me.id);
  if (!res.ok) redirect(`${back}?error=${encodeURIComponent(res.reason)}`);
  publish("report.approved", id, me.display_name);
  redirect(`${back}?approved=1`);
}
