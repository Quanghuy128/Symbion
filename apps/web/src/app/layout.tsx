import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Symbion",
  description: "Visual builder for AI-coding autoworkflows",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
