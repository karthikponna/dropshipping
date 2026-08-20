import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Generated shops use picsum.photos placeholders (see lib/framework/*).
      { protocol: "https", hostname: "picsum.photos" },
      // Google account pictures, served from lh3/lh4/lh5/lh6. Mirrored by the
      // host allowlist in lib/auth/avatar.ts.
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
  devIndicators: {
    // Its default corner is the bottom of the sidebar rail, where it covers the
    // sign-out control — the console's only way out.
    position: "bottom-right",
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // The local HydraDB node stores its graph in ./.hydradb and compacts
      // continuously, writing new SST files every few seconds. The dev watcher
      // would otherwise treat each one as a source change and recompile in a
      // loop, which thrashes the server into transient ENOENTs for chunks it is
      // busy rewriting.
      const ignored = config.watchOptions?.ignored;
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          ...(Array.isArray(ignored) ? ignored : typeof ignored === "string" ? [ignored] : []),
          "**/.hydradb/**",
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
