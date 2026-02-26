import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, featureTagStorage } from "../src/index";
import { openai, _setClientForTesting } from "../src/openai";

const mockCreate = vi.fn();

let fetchSpy: ReturnType<typeof vi.fn>;
let telemetryPayloads: any[];

beforeEach(() => {
  telemetryPayloads = [];
  fetchSpy = vi.fn().mockImplementation(async (_url: string, options: any) => {
    telemetryPayloads.push(JSON.parse(options.body));
    return { ok: true };
  });
  vi.stubGlobal("fetch", fetchSpy);
  init({ trackerApiKey: "key", projectId: "proj-1", enabled: true });
  mockCreate.mockReset();
  _setClientForTesting({ chat: { completions: { create: mockCreate } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openai non-streaming", () => {
  it("sends telemetry with correct tokens", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.usage.prompt_tokens).toBe(10);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4",
      input_tokens: 10,
      output_tokens: 20,
      project_id: "proj-1",
    });
    expect(telemetryPayloads[0].latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("uses feature_tag from observe context", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 5, completion_tokens: 10 },
    });

    await featureTagStorage.run("search-feature", async () => {
      await openai.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "test" }],
      });
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0].feature_tag).toBe("search-feature");
  });

  it("prefers explicit feature_tag param", async () => {
    mockCreate.mockResolvedValue({
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await featureTagStorage.run("context-tag", async () => {
      await openai.chat.completions.create({
        model: "gpt-4",
        messages: [],
        feature_tag: "explicit-tag",
      });
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0].feature_tag).toBe("explicit-tag");
  });

  it("strips feature_tag before forwarding to real client", async () => {
    mockCreate.mockResolvedValue({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } });

    await openai.chat.completions.create({
      model: "gpt-4",
      messages: [],
      feature_tag: "my-tag",
    });

    const forwardedParams = mockCreate.mock.calls[0][0];
    expect(forwardedParams.feature_tag).toBeUndefined();
    expect(forwardedParams.model).toBe("gpt-4");
  });

  it("does not throw when telemetry fails", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    mockCreate.mockResolvedValue({ choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } });

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [],
    });

    expect(response).toBeDefined();
  });
});

describe("openai streaming", () => {
  it("wraps stream and sends telemetry after consumption", async () => {
    const chunks = [
      { choices: [{ delta: { content: "hel" } }], usage: null },
      { choices: [{ delta: { content: "lo" } }], usage: null },
      { choices: [], usage: { prompt_tokens: 15, completion_tokens: 25 } },
    ];

    mockCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    const received: any[] = [];
    for await (const chunk of stream) {
      received.push(chunk);
    }

    expect(received).toHaveLength(3);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4",
      input_tokens: 15,
      output_tokens: 25,
    });
  });

  it("auto-injects stream_options.include_usage", async () => {
    mockCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      },
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [],
      stream: true,
    });

    for await (const _ of stream) {}

    const forwardedParams = mockCreate.mock.calls[0][0];
    expect(forwardedParams.stream_options).toEqual({ include_usage: true });
  });

  it("preserves existing stream_options", async () => {
    mockCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [], usage: { prompt_tokens: 0, completion_tokens: 0 } };
      },
    });

    const stream = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [],
      stream: true,
      stream_options: { some_other: true },
    });

    for await (const _ of stream) {}

    const forwardedParams = mockCreate.mock.calls[0][0];
    expect(forwardedParams.stream_options).toEqual({ some_other: true, include_usage: true });
  });
});
