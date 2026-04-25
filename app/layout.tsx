import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Model Browser",
  description: "Browse cached model inventories from multiple providers"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
