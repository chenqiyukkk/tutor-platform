import type { NextConfig } from "next";

const resetPageHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
];

const nextConfig: NextConfig = {
  async headers() {
    return ["teacher", "parent", "admin"].map((role) => ({
      source: `/${role}/reset-password`,
      headers: resetPageHeaders,
    }));
  },
};

export default nextConfig;
