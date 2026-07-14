import type { NextConfig } from "next";

import { buildSecurityHeaders } from "./src/lib/security-headers";

const resetPageHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders() }, ...["teacher", "parent", "admin"].map((role) => ({
      source: `/${role}/reset-password`,
      headers: resetPageHeaders,
    }))];
  },
};

export default nextConfig;
