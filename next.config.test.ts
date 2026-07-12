import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("password reset response headers", () => {
  it("prevents referrer leakage and caching for every role reset page", async () => {
    const headers = await nextConfig.headers!();

    for (const role of ["teacher", "parent", "admin"]) {
      const rule = headers.find((candidate) => candidate.source === `/${role}/reset-password`);
      expect(rule?.headers).toEqual(expect.arrayContaining([
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ]));
    }
  });
});
