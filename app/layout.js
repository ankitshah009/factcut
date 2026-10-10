import "./globals.css";
import { Fraunces, IBM_Plex_Mono } from "next/font/google";

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Factcut",
  description:
    "Picture quality and information quality for a video, cut from a Cala query.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
