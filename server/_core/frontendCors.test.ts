import { describe, expect, it, vi } from "vitest";
import {
  applyFrontendCors,
  createFrontendOriginAllowlist,
  normalizeFrontendOrigin,
} from "./frontendCors";

describe("frontend CORS allowlist", () => {
  it("normalizes trailing slashes and merges configured origins", () => {
    expect(normalizeFrontendOrigin(" https://example.test/ ")).toBe("https://example.test");
    const origins = createFrontendOriginAllowlist("https://example.test/");
    expect(origins.has("https://example.test")).toBe(true);
    expect(origins.has("https://truthsearch-production-himanshu90909s-projects.vercel.app")).toBe(true);
  });

  it("sets credentialed CORS headers for an approved origin", () => {
    const headers = new Map<string, string>();
    const req = { header: vi.fn().mockReturnValue("https://example.test") } as never;
    const res = { header: vi.fn((key: string, value: string) => headers.set(key, value)) } as never;

    const allowed = applyFrontendCors(req, res, createFrontendOriginAllowlist("https://example.test"));

    expect(allowed).toBe(true);
    expect(headers.get("Access-Control-Allow-Origin")).toBe("https://example.test");
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
  });

  it("does not emit CORS headers for an unapproved origin", () => {
    const req = { header: vi.fn().mockReturnValue("https://attacker.example") } as never;
    const res = { header: vi.fn() } as never;

    expect(applyFrontendCors(req, res, createFrontendOriginAllowlist())).toBe(false);
    expect(res.header).not.toHaveBeenCalled();
  });
});
