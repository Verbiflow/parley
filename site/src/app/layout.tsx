import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"
import "./globals.css"

const mono = Geist_Mono({ variable: "--font-mono-face", subsets: ["latin"] })

const description =
  "Parley is open source messaging infrastructure for agents. Link your accounts once, and any MCP agent can text people as you, at a human pace, with every message on record."

export const metadata: Metadata = {
  title: "Parley · Let your agents text people as you",
  description,
  openGraph: { title: "Parley · Let your agents text people as you", description, type: "website" },
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mono.variable}>
      <head>
        {/* Switzer's license allows serving it from Fontshare but not shipping its files in a public repo. */}
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" />
      </head>
      {/* Browser extensions (ColorZilla, Grammarly…) add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning className="min-h-screen overflow-x-hidden text-[15px] leading-relaxed">{children}</body>
    </html>
  )
}
