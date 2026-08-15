import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@dialogue-atlas/atlas-graph": fileURLToPath(new URL("../atlas-graph/src/index.ts", import.meta.url)),
      "@dialogue-atlas/relay-contract": fileURLToPath(new URL("../relay-contract/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
