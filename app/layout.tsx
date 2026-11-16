import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claudeku Studio — Bikin Short Animasi Three.js",
  description: "Studio web untuk membuat short animasi 3D 9:16 dari template threejs-cinematic-short, dengan prompt AI (custom provider OpenAI-compatible).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
