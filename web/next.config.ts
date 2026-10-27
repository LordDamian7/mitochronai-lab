import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The lab server is reached over the LAN or a private network (Tailscale); no image CDN, no telemetry endpoints needed.
  images: { unoptimized: true },
  // Browser security headers on every response. frame-ancestors / X-Frame-Options stop another site framing the app
  // to trick a signed-in chief into clicking "Approve" (clickjacking); the referrer policy keeps request URLs out of other sites' logs.
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        // "same-origin", not "no-referrer": with no-referrer Chrome sends "Origin: null" on plain form posts (a click before the
        // page's scripts load), and Next.js's server-action CSRF check then rejects the sign-in. Other sites still get nothing.
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    }];
  },
};

export default nextConfig;
