import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const flaskUrl = process.env.FLASK_API_URL || "http://localhost:5001";
    return [
      {
        source: "/api/scrape",
        destination: `${flaskUrl}/api/scrape`,
      },
      {
        source: "/api/status",
        destination: `${flaskUrl}/api/status`,
      },
      {
        source: "/api/stop",
        destination: `${flaskUrl}/api/stop`,
      },
      {
        source: "/api/files",
        destination: `${flaskUrl}/api/files`,
      },
      {
        source: "/api/download/:path*",
        destination: `${flaskUrl}/api/download/:path*`,
      },
      {
        source: "/api/v2/keys",
        destination: `${flaskUrl}/api/v2/keys`,
      },
      {
        source: "/api/v2/stream",
        destination: `${flaskUrl}/api/v2/stream`,
      },
      {
        source: "/api/v2/keys/verify",
        destination: `${flaskUrl}/api/v2/keys/verify`,
      },
      {
        source: "/api/v2/keys/:provider",
        destination: `${flaskUrl}/api/v2/keys/:provider`,
      },
      {
        source: "/api/v2/billing",
        destination: `${flaskUrl}/api/v2/billing`,
      },
      // Observability endpoints served directly by the Flask backend.
      {
        source: "/api/v2/analytics",
        destination: `${flaskUrl}/api/v2/analytics`,
      },
      {
        source: "/api/v2/alerts",
        destination: `${flaskUrl}/api/v2/alerts`,
      },
      {
        source: "/api/v2/alerts/read",
        destination: `${flaskUrl}/api/v2/alerts/read`,
      },
      {
        source: "/api/v2/jobs/:id/logs",
        destination: `${flaskUrl}/api/v2/jobs/:id/logs`,
      },
      {
        source: "/api/v2/jobs/:id/retries",
        destination: `${flaskUrl}/api/v2/jobs/:id/retries`,
      },
      // Auth, user management, and audit are served by the Flask backend.
      {
        source: "/api/v2/auth/:path*",
        destination: `${flaskUrl}/api/v2/auth/:path*`,
      },
      {
        source: "/api/v2/users",
        destination: `${flaskUrl}/api/v2/users`,
      },
      {
        source: "/api/v2/users/:id",
        destination: `${flaskUrl}/api/v2/users/:id`,
      },
      {
        source: "/api/v2/audit",
        destination: `${flaskUrl}/api/v2/audit`,
      },
      {
        source: "/api/v2/records/:id/enrich",
        destination: `${flaskUrl}/api/v2/records/:id/enrich`,
      },
      // Network policy (UA rotation, rate limit, proxies) + scheduling.
      {
        source: "/api/v2/netpolicy",
        destination: `${flaskUrl}/api/v2/netpolicy`,
      },
      {
        source: "/api/v2/netpolicy/proxies",
        destination: `${flaskUrl}/api/v2/netpolicy/proxies`,
      },
      {
        source: "/api/v2/netpolicy/proxies/:id",
        destination: `${flaskUrl}/api/v2/netpolicy/proxies/:id`,
      },
      {
        source: "/api/v2/schedules",
        destination: `${flaskUrl}/api/v2/schedules`,
      },
      {
        source: "/api/v2/schedules/:id",
        destination: `${flaskUrl}/api/v2/schedules/:id`,
      },
      // NOTE: /api/v2/jobs and /api/v2/enrich_job intentionally have no rewrite
      // here. They are served by local Next.js route handlers
      // (app/api/v2/jobs/route.ts, app/api/v2/enrich_job/route.ts) which insert
      // the scrape_jobs row and then proxy to Flask themselves. A rewrite would
      // be dead config anyway, since local routes take precedence over rewrites.
    ];
  },
};

export default nextConfig;
