"use client";

/** A submit button that asks "Are you sure?" first; cancelling stops the form. */
export default function ConfirmSubmit({ message, children, disabled, className = "btn btn-primary" }: { message: string; children: React.ReactNode; disabled?: boolean; className?: string }) {
  return <button className={className} type="submit" disabled={disabled} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>;
}
