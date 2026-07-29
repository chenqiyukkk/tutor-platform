import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("single-server Docker deployment", () => {
  it("builds a minimal standalone Next.js runtime", () => {
    expect(nextConfig.output).toBe("standalone");
    const dockerfile = read("./Dockerfile");
    expect(dockerfile).toContain("apt-get install -y --no-install-recommends openssl");
    expect(dockerfile).toContain("FROM base AS migration");
    expect(dockerfile).toMatch(/FROM base AS migration[\s\S]*?RUN npm run db:generate[\s\S]*?FROM base AS runner/u);
    expect(dockerfile).toContain("FROM base AS runner");
    expect(dockerfile).toContain("USER nextjs");
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });

  it("gates application startup on database preparation", () => {
    const compose = read("./compose.production.yaml");
    expect(compose).toContain("prepare:");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).not.toContain("5432:5432");
    expect(compose).toContain("127.0.0.1:3000:3000");
  });

  it("terminates public HTTPS through Caddy without embedded secrets", () => {
    const caddy = read("./Caddyfile");
    const environment = read("./.env.production.example");
    expect(caddy).toContain("{$DOMAIN}");
    expect(caddy).toContain("reverse_proxy app:3000");
    expect(environment).toContain('DOMAIN="example.com"');
    expect(environment).not.toMatch(/SESSION_SECRET="[^"]{32,}"/u);
    expect(environment).not.toMatch(/POSTGRES_PASSWORD="[^"]{16,}"/u);
  });
});
