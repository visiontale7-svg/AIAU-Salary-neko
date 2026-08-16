import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@dialogue-atlas/atlas-graph": fileURLToPath(new URL("../../packages/atlas-graph/src/index.ts", import.meta.url)),
      "@dialogue-atlas/relay-contract": fileURLToPath(new URL("../../packages/relay-contract/src/index.ts", import.meta.url)),
      "@dialogue-atlas/relay-room": fileURLToPath(new URL("../../packages/relay-room/src/index.ts", import.meta.url)),
      "@dialogue-atlas/relay-supabase": fileURLToPath(new URL("../../packages/relay-supabase/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
