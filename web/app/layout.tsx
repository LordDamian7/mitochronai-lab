import type { Metadata } from "next";
import "./globals.css";

// Fonts are bundled in public/fonts (see globals.css): the app builds and runs with no internet, which offline USB updates need.

export const metadata: Metadata = {
  title: { default: "MitochronAi Lab", template: "%s · MitochronAi Lab" },
  description: "Laboratory workflow with Gaya, the AI lab assistant",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
