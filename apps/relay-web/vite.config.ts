import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { relayContentSecurityPolicy } from "./src/security-policy";

export default defineConfig(({ mode }) => {
  const appRoot = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, appRoot, "VITE_");
  const contentSecurityPolicy = relayContentSecurityPolicy(env.VITE_SUPABASE_URL);
  return {
    plugins: [
      react(),
      {
        name: "relay-content-security-policy",
        apply: "build",
        transformIndexHtml: {
          order: "pre",
          handler: () => [{
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
            injectTo: "head-prepend",
          }],
        },
      },
    ],
    resolve: {
      alias: {
        "@dialogue-atlas/atlas-graph": fileURLToPath(new URL("../../packages/atlas-graph/src/index.ts", import.meta.url)),
        "@dialogue-atlas/relay-contract": fileURLToPath(new URL("../../packages/relay-contract/src/index.ts", import.meta.url)),
        "@dialogue-atlas/relay-room": fileURLToPath(new URL("../../packages/relay-room/src/index.ts", import.meta.url)),
        "@dialogue-atlas/relay-supabase": fileURLToPath(new URL("../../packages/relay-supabase/src/index.ts", import.meta.url)),
      },
    },
    // Vite's React refresh preamble is inline in development. Production and
    // preview stay strict; dev keeps only the referrer boundary.
    server: { headers: { "Referrer-Policy": "no-referrer" } },
    preview: { headers: { "Content-Security-Policy": contentSecurityPolicy, "Referrer-Policy": "no-referrer" } },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
