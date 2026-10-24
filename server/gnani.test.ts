import { afterEach, describe, expect, it } from "vitest";
import { gnaniConfigured, gnaniSpeak, gnaniTranscribe, markdownToSpeech } from "./gnani";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GNANI_API_KEY;
});

describe("gnani speech module", () => {
  it("marks the integration unconfigured without a key", () => {
    delete process.env.GNANI_API_KEY;
    expect(gnaniConfigured()).toBe(false);
  });

  it("rejects transcription and synthesis with a clear error when unconfigured", async () => {
    delete process.env.GNANI_API_KEY;
    await expect(gnaniTranscribe({ audioBase64: Buffer.from("wav").toString("base64"), mimeType: "audio/wav", languageCode: "hi-IN" })).rejects.toThrow("GNANI_API_KEY");
    await expect(gnaniSpeak({ text: "hello", language: "auto" })).rejects.toThrow("GNANI_API_KEY");
  });

  it("transcribes via the Prisma v3 REST endpoint and returns the trimmed transcript", async () => {
    process.env.GNANI_API_KEY = "test-key";
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    globalThis.fetch = (async (input: any, init?: any) => {
      calls.push({ url: String(input), headers: init?.headers || {} });
      return new Response(JSON.stringify({ success: true, request_id: "req_1", transcript: "  Solid-state batteries ka latest update  " }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await gnaniTranscribe({ audioBase64: Buffer.from("fake-audio").toString("base64"), mimeType: "audio/wav", languageCode: "hi-IN" });
    expect(result.transcript).toBe("Solid-state batteries ka latest update");
    expect(result.requestId).toBe("req_1");
    expect(calls[0].url).toContain("/stt/v3");
    expect(calls[0].headers["X-API-Key-ID"]).toBe("test-key");
  });

  it("surfaces the provider error message on failure", async () => {
    process.env.GNANI_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, error: { type: "RATE_LIMIT_ERROR", message: "Rate limit exceeded." } }), { status: 429 })
    ) as unknown as typeof fetch;
    await expect(gnaniTranscribe({ audioBase64: Buffer.from("x").toString("base64"), mimeType: "audio/wav", languageCode: "hi-IN" })).rejects.toThrow("Rate limit exceeded");
  });

  it("synthesizes speech and returns base64 mp3 audio", async () => {
    process.env.GNANI_API_KEY = "test-key";
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input: any, init?: any) => {
      bodies.push(JSON.parse(init?.body));
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await gnaniSpeak({ text: "Hello", language: "auto" });
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.audioBase64).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
    const body = bodies[0] as { model: string; language: string; audio_config: { container: string } };
    expect(body.model).toBe("timbre-v2.5");
    expect(body.language).toBe("auto");
    expect(body.audio_config.container).toBe("mp3");
  });

  it("caps spoken text at 3500 characters", async () => {
    process.env.GNANI_API_KEY = "test-key";
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input: any, init?: any) => {
      bodies.push(JSON.parse(init?.body));
      return new Response(new Uint8Array([9]), { status: 200 });
    }) as unknown as typeof fetch;
    await gnaniSpeak({ text: "a".repeat(6000), language: "auto" });
    expect((bodies[0] as { text: string }).text.length).toBeLessThanOrEqual(3500);
  });

  it("strips markdown so Timbre reads prose, not syntax", () => {
    const spoken = markdownToSpeech("## Heading\n\n**Bold** claim [cited source](https://example.com) and code:\n```py\nprint(1)\n```\nEnd https://example.com/x");
    expect(spoken).not.toMatch(/[#*`]/);
    expect(spoken).toContain("Bold claim cited source");
    expect(spoken).toContain("code snippet omitted");
    expect(spoken).not.toContain("https://");
  });
});
