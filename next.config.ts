import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Generated shops use picsum.photos placeholders (see lib/framework/*).
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
  devIndicators: {
    // Its default corner is the bottom of the sidebar rail, where it covers the
    // sign-out control — the console's only way out.
    position: "bottom-right",
  },
};

export default nextConfig;
