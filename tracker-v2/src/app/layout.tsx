import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yacht Ops · Tracker v2",
  description: "Commercial charter operations platform (parallel to live v1)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
