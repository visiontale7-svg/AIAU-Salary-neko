import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const webRoot = path.join(root, "apps", "relay-web");
const sourceRoots = [
  webRoot,
  path.join(root, "packages", "relay-contract"),
  path.join(root, "packages", "atlas-graph"),
  path.join(root, "packages", "relay-room"),
  path.join(root, "packages", "relay-supabase"),
  path.join(root, "supabase", "functions"),
];
const distRoot = path.join(webRoot, "dist");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".mjs", ".ts", ".tsx"]);

async function filesUnder(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(absolute);
      return entry.isFile() ? [absolute] : [];
    }));
    return nested.flat();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

const failures = [];
for (const sourceRoot of sourceRoots) {
  for (const file of await filesUnder(sourceRoot)) {
    if (!textExtensions.has(path.extname(file))) continue;
    const text = await readFile(file, "utf8");
    if (/from\s+["']@tauri-apps\//.test(text) || /import\s*\(["']@tauri-apps\//.test(text)) {
      failures.push(`${path.relative(root, file)} imports a Tauri package`);
    }
    if (/from\s+["']elkjs(?:\/|["'])/.test(text) || /import\s*\(["']elkjs/.test(text)) {
      failures.push(`${path.relative(root, file)} imports ELK`);
    }
  }
}

const distFiles = await filesUnder(distRoot);
if (!distFiles.length) failures.push("Relay Web dist is missing; run npm run build:relay first");
for (const file of distFiles) {
  if (!textExtensions.has(path.extname(file))) continue;
  if ((await stat(file)).size > 12_000_000) continue;
  const text = await readFile(file, "utf8");
  const checks = [
    [/@tauri-apps\//, "Tauri dependency"],
    [/elkjs/, "ELK dependency"],
    [/DEVIN_API_KEY|DEVIN_ORG_ID|SUPABASE_SERVICE_ROLE_KEY/, "server-only secret name"],
    [/cog_[A-Za-z0-9_-]{20,}/, "Devin credential-shaped value"],
    [/\/Users\/visiontale7\//, "local absolute path"],
    [/80000000-0000-4000-8000-000000000001/, "privacy canary UUID"],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.test(text)) failures.push(`${path.relative(root, file)} contains ${label}`);
  }
}

if (failures.length) {
  console.error(`Relay boundary check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`Relay boundary check passed (${distFiles.length} dist files scanned).`);
