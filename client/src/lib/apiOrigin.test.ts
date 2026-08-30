import { describe, expect, it } from "vitest";
import {
  MANAGED_BACKEND_ORIGIN,
  VERCEL_FRONTEND_HOST,
  getResearchApiUrl,
} from "./apiOrigin";

describe("research API origin", () => {
  it("uses the managed backend for the current Vercel frontend", () => {
    expect(getResearchApiUrl(VERCEL_FRONTEND_HOST)).toBe(
      `${MANAGED_BACKEND_ORIGIN}/api/trpc`
    );
  });

  it("keeps same-origin routing for local or managed full-stack pages", () => {
    expect(getResearchApiUrl("localhost")).toBe("/api/trpc");
    expect(getResearchApiUrl("truthsearch-aynnqgr5.manus.space")).toBe("/api/trpc");
  });

  it("honors an explicit backend origin for split deployments", () => {
    expect(getResearchApiUrl("netlify.app", "https://api.example.test/")).toBe(
      "https://api.example.test/api/trpc"
    );
  });
});
