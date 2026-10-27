"use client";
import { useEffect } from "react";

/**
 * Warns before leaving a form with typed but unsaved changes: closing or reloading the tab (the browser's own dialog)
 * and clicking a link inside the app (a confirm box). Submitting the form clears the warning.
 */
export default function UnsavedGuard({ formId, message = "You have unsaved changes on this page. Leave without saving?" }: { formId: string; message?: string }) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let dirty = false;
    const mark = () => { dirty = true; form.dataset.dirty = "1"; };
    const clear = () => { dirty = false; delete form.dataset.dirty; };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    const onClick = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || form.contains(a) && a.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation(); } else clear();
    };
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    form.addEventListener("submit", clear);
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("submit", clear);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [formId, message]);
  return null;
}
