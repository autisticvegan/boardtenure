import type { Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const viewport: Viewport = { themeColor: "#0b0d12", colorScheme: "dark" };

// Shared shell for both sites; each site's chrome lives in its own layout ((boardtape)/, hiw/).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh flex flex-col text-[14px] leading-[22px]">{children}</body>
    </html>
  );
}
