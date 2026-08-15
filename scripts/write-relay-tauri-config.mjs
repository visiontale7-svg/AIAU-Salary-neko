import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadEnv } from "vite";

const root = process.cwd();
const fileEnvironment = loadEnv(process.env.NODE_ENV ?? "production", root, "");
const value = (process.env.VITE_SUPABASE_URL ?? fileEnvironment.VITE_SUPABASE_URL)?.trim();
const localIntegration = (process.env.VITE_RELAY_LOCAL_INTEGRATION
  ?? fileEnvironment.VITE_RELAY_LOCAL_INTEGRATION) === "1";
if (!value) {
  console.error("VITE_SUPABASE_URL is required to generate the exact Relay CSP overlay.");
  process.exit(1);
}

let url;
try {
  url = new URL(value);
} catch {
  console.error("VITE_SUPABASE_URL is not a valid URL.");
  process.exit(1);
}

const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
const permittedLocalHttp = localIntegration && url.protocol === "http:" && isLoopback;
if ((url.protocol !== "https:" && !permittedLocalHttp)
  || url.username
  || url.password
  || url.search
  || url.hash
  || url.pathname !== "/") {
  console.error("VITE_SUPABASE_URL must be a bare HTTPS origin, or exact loopback HTTP with VITE_RELAY_LOCAL_INTEGRATION=1.");
  process.exit(1);
}

const apiOrigin = url.origin;
const websocketOrigin = `${permittedLocalHttp ? "ws" : "wss"}://${url.host}`;
const csp = [
  "default-src 'self'",
  `connect-src 'self' ipc: http://ipc.localhost ${apiOrigin} ${websocketOrigin}`,
  "img-src 'self' asset: http://asset.localhost data:",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const overlay = {
  app: { security: { csp } },
};
const requestedOutput = process.env.RELAY_TAURI_CONFIG_OUTPUT
  ?? "src-tauri/tauri.relay.generated.conf.json";
const destination = path.resolve(root, requestedOutput);
if (!destination.startsWith(`${path.resolve(root, "src-tauri")}${path.sep}`)
  || !destination.endsWith(".generated.conf.json")) {
  console.error("RELAY_TAURI_CONFIG_OUTPUT must be a generated config inside src-tauri.");
  process.exit(1);
}
await writeFile(destination, `${JSON.stringify(overlay, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`Wrote exact Relay CSP overlay for ${apiOrigin} to ${path.relative(root, destination)}`);
