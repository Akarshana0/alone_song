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
    // NOTE: previously this aliased `tone` to its UMD build
    // (tone/build/Tone.js) to sidestep an ESM resolution warning during
    // the server build. That alias is what caused the production-only
    // "Tone.Meter is not a constructor" crash: under webpack's production
    // optimizations the UMD build's exports didn't line up with the
    // `.default` interop used in lib/audioEngine.ts and friends. Letting
    // webpack resolve the standard package (its normal ESM/CJS entry)
    // works correctly for a client-only ("use client") module like this.
    return config;
  },
};

module.exports = nextConfig;
