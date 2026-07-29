import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("password reset response headers", () => {
  it("applies the global security header policy to every route", async () => {
    const headers = await nextConfig.headers!();
    const global = headers.find((candidate) => candidate.source === "/:path*");
    expect(global?.headers).toEqual(expect.arrayContaining([
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      expect.objectContaining({ key: "Content-Security-Policy" }),
    ]));
  });

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
