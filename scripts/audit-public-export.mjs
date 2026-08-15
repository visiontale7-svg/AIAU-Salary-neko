import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !path.isAbsolute(root)) {
  console.error("usage: node scripts/audit-public-export.mjs /absolute/public/export");
  process.exit(2);
}

const allowlistPath = path.join(scriptDir, "public-export-synthetic-allowlist.txt");
const allowlist = new Set(
  (await readFile(allowlistPath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);

const ignoredDirectories = new Set([".git", "node_modules", "target", "dist", "test-results", "playwright-report"]);
const ignoredFiles = new Set([
  "scripts/audit-public-export.mjs",
  "scripts/public-export-synthetic-allowlist.txt",
]);

async function filesUnder(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output;
}

const detectors = [
  {
    label: "email address",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu,
  },
  {
    label: "local absolute path",
    // User/workspace roots are privacy-bearing. Stable system paths such as
    // /usr/bin or /Applications/ChatGPT.app are product implementation data,
    // not machine identity, and intentionally remain publishable.
    pattern: /\/(?:Users|home|Volumes|srv|root|mnt|media|workspace)\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~+@%:,=\-\p{L}\p{N}]+)*|\/private\/var\/folders\/[A-Za-z0-9._~+@%:,=\-\p{L}\p{N}]+(?:\/[A-Za-z0-9._~+@%:,=\-\p{L}\p{N}]+)*/gu,
  },
  {
    label: "Windows user path",
    pattern: /[A-Za-z]:\\Users\\[^\s"'`<>]+/gu,
  },
  {
    label: "Windows UNC path",
    pattern: /\\\\[^\\\s<>:"|?*]+\\[^\\\s<>:"|?*]+/gu,
  },
  {
    label: "UUID-shaped local identifier",
    pattern: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\b/gu,
  },
  {
    label: "credential-shaped value",
    pattern: /\b(?:Bearer[ \t]+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{12,}|cog_[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|sbp_[A-Za-z0-9_-]{20,}|token=[A-Za-z0-9_-]{12,})\b/gu,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    label: "assigned server secret",
    // Horizontal whitespace keeps an intentionally empty .env.example value
    // from consuming the next line as if it were a secret.
    pattern: /\b(?:DEVIN_API_KEY|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY)[ \t]*=[ \t]*[^\s"'#]+/gu,
  },
];

const failures = [];
for (const file of await filesUnder(root)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (
    relative.split("/").includes(".planning")
    || /^(?:findings|progress|task_plan)\.md$/u.test(relative)
    || /^WINDOWS_/u.test(relative)
    || /^docs\/windows-/u.test(relative)
    || /^docs\/Dialogue_Atlas_黑客松/u.test(relative)
  ) {
    failures.push(`${relative}: internal planning or handoff artifact is not publishable`);
    continue;
  }
  if (ignoredFiles.has(relative)) continue;
  const info = await stat(file);
  if (info.size > 20_000_000) {
    failures.push(`${relative}: file exceeds the public text-audit limit`);
    continue;
  }
  const bytes = await readFile(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const detector of detectors) {
    for (const match of text.matchAll(detector.pattern)) {
      const value = match[0];
      if (allowlist.has(value)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      failures.push(`${relative}:${line}: contains ${detector.label}`);
    }
  }
}

if (failures.length) {
  console.error(`Public export privacy audit failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log("Public export privacy audit passed");
