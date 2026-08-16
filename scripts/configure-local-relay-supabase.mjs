import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const relayWebUrl = "http://127.0.0.1:5173";
const managedKeys = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_RELAY_LOCAL_INTEGRATION",
  "VITE_RELAY_WEB_URL",
];

function readLocalStatus() {
  let raw;
  try {
    raw = execFileSync("supabase", ["status", "--output", "json"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Local Supabase is not running. Start it with `supabase start` first.");
  }
  const status = JSON.parse(raw);
  const apiUrl = status.API_URL ?? status.api_url;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.publishable_key;
  if (!apiUrl || !publishableKey) {
    throw new Error("Supabase status did not return API_URL and PUBLISHABLE_KEY.");
  }
  const url = new URL(apiUrl);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "http:" || !loopback || url.username || url.password || url.search || url.hash) {
    throw new Error("Local integration accepts only an exact loopback HTTP Supabase origin.");
  }
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("Refusing to write a non-publishable Supabase credential into a Vite env file.");
  }
  return { apiUrl: url.origin, publishableKey };
}

async function updateEnvFile(filePath, values) {
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const retained = current
    .split(/\r?\n/)
    .filter((line) => !managedKeys.some((key) => line.startsWith(`${key}=`)))
    .join("\n")
    .trimEnd();
  const managed = [
    "# Dialogue Atlas Relay local Supabase (generated; public client values only)",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  ].join("\n");
  const next = `${retained ? `${retained}\n\n` : ""}${managed}\n`;
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, next, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

const { apiUrl, publishableKey } = readLocalStatus();
await updateEnvFile(path.join(root, ".env.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_WEB_URL: relayWebUrl,
  VITE_RELAY_LOCAL_INTEGRATION: "1",
});
// Vite gives mode-specific local files higher priority than `.env.local` in a
// production build. Keep the packaged Tauri app on one coherent local stack
// instead of accidentally mixing stale linked-project values with loopback.
await updateEnvFile(path.join(root, ".env.production.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_WEB_URL: relayWebUrl,
  VITE_RELAY_LOCAL_INTEGRATION: "1",
});
await updateEnvFile(path.join(root, "apps/relay-web/.env.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_LOCAL_INTEGRATION: "1",
});
await updateEnvFile(path.join(root, "apps/relay-web/.env.production.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_LOCAL_INTEGRATION: "1",
});

execFileSync(process.execPath, ["scripts/write-relay-tauri-config.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: apiUrl,
    VITE_RELAY_LOCAL_INTEGRATION: "1",
  },
  stdio: ["ignore", "ignore", "inherit"],
});

console.log(`Configured Relay for local Supabase at ${apiUrl}`);
console.log("Wrote ignored dev/production public-client env files and the exact loopback Tauri CSP overlay.");
console.log("No service-role, secret key, database password, or Devin credential was written.");
