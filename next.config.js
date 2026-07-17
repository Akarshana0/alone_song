/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["tone"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    if (!isServer) {
      config.optimization.concatenateModules = false;
      config.module.rules.push({
        test: /[\\/]node_modules[\\/]tone[\\/]/,
        sideEffects: true,
      });
    }
    return config;
  },
};

module.exports = nextConfig;
