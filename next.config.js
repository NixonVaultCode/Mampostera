const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, os: false, net: false, tls: false,
        crypto:  require.resolve("crypto-browserify"),
        stream:  require.resolve("stream-browserify"),
        buffer:  require.resolve("buffer/"),
        zlib:    require.resolve("browserify-zlib"),
        process: require.resolve("process/browser"),
        vm:      require.resolve("vm-browserify"),
      };
      const webpack = require("webpack");
      config.plugins.push(
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"], process: "process/browser" })
      );
    }
    return config;
  },

  transpilePackages: ["@solana/wallet-adapter-react-ui"],
};

// withSentryConfig COMO CAPA EXTERIOR — resolver conflicto HIGH detectado
module.exports = withSentryConfig(nextConfig, {
  silent:          true,
  hideSourceMaps:  true,
  disableLogger:   true,
  tunnelRoute:     "/monitoring",
});
