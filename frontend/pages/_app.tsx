import "@/styles/globals.css";
import type { AppProps } from "next/app";
import TopNav from "@/components/TopNav";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <TopNav />
      <Component {...pageProps} />
    </>
  );
}