"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavLink({ href, children, badge, attn }: { href: string; children: React.ReactNode; badge?: number; attn?: boolean }) {
  const path = usePathname();
  const active = path === href || (href !== "/" && path.startsWith(href + "/")) || (href === "/worklist" && path.startsWith("/orders"));
  return (
    <Link href={href} className="navlink" aria-current={active ? "page" : undefined}>
      <span>{children}</span>
      {badge ? <span className={`badge${attn ? " attn" : ""}`}>{badge}</span> : null}
    </Link>
  );
}
