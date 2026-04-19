import type { NextConfig } from "next";

const STUDIO_ORIGINS = (
  process.env.FACTORY_STUDIO_ORIGINS ||
  "http://local.machina:3000 http://localhost:3000 https://studio.machina.gg https://studio-staging.machina.gg"
).trim();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/factory/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${STUDIO_ORIGINS}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
