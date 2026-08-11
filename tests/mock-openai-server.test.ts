import { afterEach, describe, expect, it } from "vitest";
import { createMockOpenAiServer, type MockOpenAiServer } from "./helpers/mock-openai-server.mjs";

const running: MockOpenAiServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

function requestBody(schemaName: string, input: unknown) {
  return {
    model: "gpt-5-mini",
    store: false,
    background: false,
    input: [
      { role: "system", content: [{ type: "input_text", text: "local contract test" }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] },
    ],
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema: {} } },
  };
}

async function post(server: MockOpenAiServer, schemaName: string, input: unknown) {
  return fetch(`${server.baseUrl}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${server.expectedKey}`, "content-type": "application/json" },
    body: JSON.stringify(requestBody(schemaName, input)),
  });
}

describe("localhost OpenAI acceptance server", () => {
  it("binds locally, checks the test key, and serves model readiness", async () => {
    const server = await createMockOpenAiServer();
    running.push(server);
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/u);
    const denied = await fetch(`${server.baseUrl}/models`);
    expect(denied.status).toBe(401);
    const ready = await fetch(`${server.baseUrl}/models`, {
      headers: { authorization: `Bearer ${server.expectedKey}` },
    });
    expect(ready.status).toBe(200);
  });

  it("returns UTF-16-verifiable units and records privacy flags", async () => {
    const server = await createMockOpenAiServer();
    running.push(server);
    const text = "中文🧭 evidence";
    const response = await post(server, "dialogue_units", {
      turns: [
        {
          turnId: "turn-1",
          speaker: "user",
          operationOnly: false,
          messages: [{ messageId: "message-1", text }],
        },
      ],
    });
    expect(response.status).toBe(200);
    const envelope = await response.json();
    const output = JSON.parse(envelope.output[0].content[0].text);
    expect(output.units[0].spans[0]).toEqual({
      messageId: "message-1",
      startUtf16: 0,
      endUtf16: text.length,
      exactQuote: text,
    });
    expect(server.requests[0]).toMatchObject({
      url: "/v1/responses",
      authorizationPresent: true,
      store: false,
      background: false,
      schemaName: "dialogue_units",
    });
  });

  it("supports deterministic partial and retry fixtures without automatic replay", async () => {
    const partial = await createMockOpenAiServer({ scenario: "partial" });
    running.push(partial);
    const relationInput = {
      sourceUnitIds: ["assistant"],
      catalog: [
        { unitId: "user", speaker: "user" },
        { unitId: "assistant", speaker: "assistant" },
      ],
    };
    expect((await post(partial, "dialogue_relations", relationInput)).status).toBe(503);

    const retry = await createMockOpenAiServer({ scenario: "retry_once" });
    running.push(retry);
    const segmentInput = {
      turns: [
        {
          turnId: "turn-1",
          speaker: "user",
          operationOnly: false,
          messages: [{ messageId: "message-1", text: "test" }],
        },
      ],
    };
    expect((await post(retry, "dialogue_units", segmentInput)).status).toBe(503);
    expect((await post(retry, "dialogue_units", segmentInput)).status).toBe(200);
    expect(retry.requests).toHaveLength(2);
  });

  it("rejects any test request that would store or background model data", async () => {
    const server = await createMockOpenAiServer();
    running.push(server);
    const body = requestBody("dialogue_units", { turns: [] });
    body.store = true;
    const response = await fetch(`${server.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${server.expectedKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  });
});

