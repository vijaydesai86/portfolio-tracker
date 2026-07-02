import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaultfolio | Privacy-first Indian portfolio planner",
  description: "Vaultfolio is a privacy-first Indian portfolio planner for imports, XIRR, goals, expenses, tax estimates, and JSON backups"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
