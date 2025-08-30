import { Inter, Plus_Jakarta_Sans } from "next/font/google";

export const body = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

export const display = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});