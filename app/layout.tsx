import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "KSB Agricultural Pump Selector",
  description: "Catalogue-backed pump selection by water flow and motor depth",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
