import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "..");
const managedKeys = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_RELAY_LOCAL_INTEGRATION",
  "VITE_RELAY_WEB_URL",
];

async function linkedProject() {
  let projectRef;
  try {
    projectRef = (await readFile(path.join(root, "supabase/.temp/project-ref"), "utf8")).trim();
  } catch {
    throw new Error("No linked Supabase project. Run `supabase link --project-ref <ref>` first.");
  }
  if (!/^[a-z]{20}$/.test(projectRef)) {
    throw new Error("The linked Supabase project reference has an unexpected shape.");
  }

  const raw = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", projectRef, "--output", "json"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const publishable = JSON.parse(raw).filter((key) => key.type === "publishable");
  if (publishable.length !== 1 || !publishable[0].api_key?.startsWith("sb_publishable_")) {
    throw new Error("Expected exactly one modern Supabase publishable key; refusing other credentials.");
  }
  return {
    apiUrl: `https://${projectRef}.supabase.co`,
    publishableKey: publishable[0].api_key,
  };
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
    "# Dialogue Atlas Relay linked Supabase (generated; public client values only)",
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  ].join("\n");
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, `${retained ? `${retained}\n\n` : ""}${managed}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, filePath);
}

const { apiUrl, publishableKey } = await linkedProject();
await updateEnvFile(path.join(root, ".env.production.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_WEB_URL: "http://127.0.0.1:4173",
  VITE_RELAY_LOCAL_INTEGRATION: "0",
});
await updateEnvFile(path.join(root, "apps/relay-web/.env.production.local"), {
  VITE_SUPABASE_URL: apiUrl,
  VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  VITE_RELAY_LOCAL_INTEGRATION: "0",
});

execFileSync(process.execPath, ["scripts/write-relay-tauri-config.mjs"], {
  cwd: root,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: apiUrl,
    VITE_RELAY_LOCAL_INTEGRATION: "0",
    RELAY_TAURI_CONFIG_OUTPUT: "src-tauri/tauri.relay.cloud.generated.conf.json",
  },
  stdio: ["ignore", "ignore", "inherit"],
});

console.log(`Configured Relay for linked Supabase project at ${apiUrl}`);
console.log("Wrote ignored production public-client env files and exact cloud Tauri CSP overlay.");
console.log("No secret credential was written.");
