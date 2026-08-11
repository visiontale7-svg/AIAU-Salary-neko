import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_KEY = "dialogue-atlas-local-test-key";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

function jsonResponse(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function responseEnvelope(value) {
  return {
    id: "resp_dialogue_atlas_local_mock",
    object: "response",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(value) }],
      },
    ],
    usage: { input_tokens: 17, output_tokens: 11 },
  };
}

function parseModelInput(body) {
  const text = body?.input
    ?.flatMap((item) => item?.content ?? [])
    ?.find((item) => item?.type === "input_text" && typeof item?.text === "string" && item.text.startsWith("{"))
    ?.text;
  if (!text) throw new Error("missing structured user input");
  return JSON.parse(text);
}

function shortLabel(text) {
  const compact = text.trim().replace(/\s+/gu, " ");
  return compact.length > 28 ? `${compact.slice(0, 28)}…` : compact || "空白发言";
}

function segmentationOutput(input, scenario) {
  const units = [];
  for (const turn of input.turns ?? []) {
    const message = (turn.messages ?? []).find((candidate) => typeof candidate?.text === "string" && candidate.text.length > 0);
    if (!message) continue;
    const invalid = scenario === "invalid_evidence" && units.length === 0;
    units.push({
      turnId: turn.turnId,
      speaker: turn.speaker,
      label: shortLabel(message.text),
      acts: [turn.speaker === "user" ? "提问" : "回答"],
      importance: turn.operationOnly ? 0.35 : 0.82,
      primary: !turn.operationOnly,
      operationOnly: Boolean(turn.operationOnly),
      spans: [
        {
          messageId: message.messageId,
          startUtf16: 0,
          endUtf16: message.text.length,
          exactQuote: invalid ? `${message.text}（无效证据）` : message.text,
        },
      ],
    });
  }
  return { units };
}

function relationsOutput(input) {
  const catalog = input.catalog ?? [];
  const allowed = new Set(input.sourceUnitIds ?? []);
  const relations = [];
  for (let index = 1; index < catalog.length; index += 1) {
    const source = catalog[index];
    const target = catalog[index - 1];
    if (source?.speaker !== "assistant" || target?.speaker !== "user" || !allowed.has(source.unitId)) continue;
    relations.push({
      source: source.unitId,
      target: target.unitId,
      kind: "回应",
      label: "回应前述问题",
      confidence: 0.91,
      evidenceUnitIds: [source.unitId, target.unitId],
    });
  }
  return { relations };
}

function modesOutput(input) {
  const units = input.units ?? [];
  return {
    modes: [{ localId: "offline-smoke", kind: "探索", label: "离线验收", confidence: 0.9 }],
    memberships: units.map((unit) => ({
      modeLocalId: "offline-smoke",
      unitId: unit.unitId,
      confidence: 0.88,
    })),
  };
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeRequestRecord(request, body) {
  return {
    at: new Date().toISOString(),
    method: request.method,
    url: request.url,
    authorizationPresent: typeof request.headers.authorization === "string",
    store: body?.store,
    background: body?.background,
    schemaName: body?.text?.format?.name,
    body,
  };
}

export async function createMockOpenAiServer(options = {}) {
  const scenario = options.scenario ?? "success";
  const expectedKey = options.expectedKey ?? DEFAULT_KEY;
  const logPath = options.logPath;
  const requests = [];
  let responseCalls = 0;

  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${expectedKey}`) {
        jsonResponse(response, 401, { error: { message: "local mock rejected the test credential" } });
        return;
      }
      if (request.method === "GET" && request.url === "/v1/models") {
        const record = safeRequestRecord(request, undefined);
        requests.push(record);
        if (logPath) appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
        jsonResponse(response, 200, { object: "list", data: [{ id: "gpt-5-mini", object: "model" }] });
        return;
      }
      if (request.method !== "POST" || request.url !== "/v1/responses") {
        jsonResponse(response, 404, { error: { message: "unsupported local mock route" } });
        return;
      }

      const body = await readJson(request);
      const record = safeRequestRecord(request, body);
      requests.push(record);
      if (logPath) appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
      if (body.store !== false || body.background !== false) {
        jsonResponse(response, 400, { error: { message: "store and background must both be false" } });
        return;
      }

      responseCalls += 1;
      const schemaName = body?.text?.format?.name;
      if (scenario === "retry_once" && responseCalls === 1) {
        jsonResponse(response, 503, { error: { message: "intentional first-attempt failure" } });
        return;
      }
      if (scenario === "partial" && schemaName === "dialogue_relations") {
        jsonResponse(response, 503, { error: { message: "intentional relation-stage failure" } });
        return;
      }
      if (scenario === "slow") {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 2_000));
      }

      const input = parseModelInput(body);
      const output =
        schemaName === "dialogue_units"
          ? segmentationOutput(input, scenario)
          : schemaName === "dialogue_relations"
            ? relationsOutput(input)
            : schemaName === "dialogue_modes"
              ? modesOutput(input)
              : null;
      if (!output) {
        jsonResponse(response, 400, { error: { message: `unsupported schema: ${String(schemaName)}` } });
        return;
      }
      jsonResponse(response, 200, responseEnvelope(output));
    } catch (error) {
      jsonResponse(response, 400, { error: { message: error instanceof Error ? error.message : "invalid request" } });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not expose a TCP address");

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    expectedKey,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  const scenario = process.env.DIALOGUE_ATLAS_MOCK_SCENARIO ?? "success";
  const instance = await createMockOpenAiServer({
    scenario,
    expectedKey: process.env.DIALOGUE_ATLAS_MOCK_API_KEY ?? DEFAULT_KEY,
    logPath: process.env.DIALOGUE_ATLAS_MOCK_LOG,
  });
  process.stdout.write(`${JSON.stringify({ baseUrl: instance.baseUrl, scenario, apiKey: instance.expectedKey })}\n`);
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

