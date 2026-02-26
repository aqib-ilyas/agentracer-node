import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { init, featureTagStorage } from "../src/index";
import { anthropic, _setClientForTesting } from "../src/anthropic";

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
  _setClientForTesting({ messages: { create: mockCreate } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("anthropic non-streaming", () => {
  it("sends telemetry with correct tokens", async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: "hello" }],
      usage: { input_tokens: 50, output_tokens: 30 },
    });

    const response = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.usage.input_tokens).toBe(50);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      input_tokens: 50,
      output_tokens: 30,
      project_id: "proj-1",
    });
  });

  it("uses feature_tag from observe context", async () => {
    mockCreate.mockResolvedValue({
      content: [],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await featureTagStorage.run("summarizer", async () => {
      await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 50,
        messages: [{ role: "user", content: "test" }],
      });
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0].feature_tag).toBe("summarizer");
  });

  it("strips feature_tag before forwarding", async () => {
    mockCreate.mockResolvedValue({ content: [], usage: { input_tokens: 0, output_tokens: 0 } });

    await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 50,
      messages: [],
      feature_tag: "my-feature",
    });

    const forwarded = mockCreate.mock.calls[0][0];
    expect(forwarded.feature_tag).toBeUndefined();
  });

  it("does not throw when telemetry fails", async () => {
    fetchSpy.mockRejectedValue(new Error("fail"));
    mockCreate.mockResolvedValue({ content: [], usage: { input_tokens: 0, output_tokens: 0 } });

    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 50,
      messages: [],
    });

    expect(response).toBeDefined();
  });
});

describe("anthropic streaming", () => {
  it("wraps stream and sends telemetry with accumulated tokens", async () => {
    const events = [
      { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 100 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: " world" } },
      { type: "message_delta", usage: { output_tokens: 40 }, delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ];

    mockCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    });

    const stream = await anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    const received: any[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toHaveLength(5);
    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads).toHaveLength(1);
    expect(telemetryPayloads[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-3-opus-20240229",
      input_tokens: 100,
      output_tokens: 40,
    });
  });

  it("handles stream with no usage gracefully", async () => {
    const events = [
      { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
      { type: "message_stop" },
    ];

    mockCreate.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event;
      },
    });

    const stream = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 50,
      messages: [],
      stream: true,
    });

    for await (const _ of stream) {}

    await new Promise((r) => setTimeout(r, 10));
    expect(telemetryPayloads[0]).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
    });
  });
});
