import "@/styles/globals.css";
import type { AppProps } from "next/app";
import TopNav from "@/components/TopNav";
import ThemeProvider from "@/components/ThemeProvider";
import { body, display } from "@/lib/fonts";

import NProgress from "nprogress";
import Router from "next/router";
import "nprogress/nprogress.css";

// 页面级进度条
NProgress.configure({ showSpinner: false, trickleSpeed: 80 });
Router.events.on("routeChangeStart", () => NProgress.start());
Router.events.on("routeChangeComplete", () => NProgress.done());
Router.events.on("routeChangeError", () => NProgress.done());

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <div className={`${body.variable} ${display.variable} font-sans`}>
        <TopNav />
        <Component {...pageProps} />
      </div>
    </ThemeProvider>
  );
}