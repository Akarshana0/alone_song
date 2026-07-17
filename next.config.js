/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    esmExternals: "loose",
  },
  // Required so FFmpeg.wasm (SharedArrayBuffer) works in the browser.
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
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    // Prefer the bundled UMD build of Tone.js to avoid ESM re-export
    // resolution issues during Next's server-side build.
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      tone: require.resolve("tone/build/Tone.js"),
    };
    return config;
  },
};

module.exports = nextConfig;
