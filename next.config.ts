import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Generated shops use picsum.photos placeholders (see lib/framework/*).
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
};

export default nextConfig;
