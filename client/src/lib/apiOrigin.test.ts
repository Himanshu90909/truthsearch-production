import { describe, expect, it } from "vitest";
import { getResearchApiUrl } from "./apiOrigin";

describe("research API origin", () => {
  it("uses same-origin routing for every host by default", () => {
    expect(getResearchApiUrl("localhost")).toBe("/api/trpc");
    expect(
      getResearchApiUrl("truthsearch-production-himanshu90909s-projects.vercel.app")
    ).toBe("/api/trpc");
  });

  it("honors an explicit backend origin for split deployments", () => {
    expect(getResearchApiUrl("netlify.app", "https://api.example.test/")).toBe(
      "https://api.example.test/api/trpc"
    );
  });
});
