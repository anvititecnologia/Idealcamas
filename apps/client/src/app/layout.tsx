// ──────────────────────────────────────────────────────────────────────────────
// Ideal Camas — Root Layout
// ──────────────────────────────────────────────────────────────────────────────
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ideal Camas — Catálogo Interativo 3D",
  description:
    "Configure e personalize seu sofá ou cama em 3D. Escolha tecidos, medidas e adicionais com visualização em tempo real.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
