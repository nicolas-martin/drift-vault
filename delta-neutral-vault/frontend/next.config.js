/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        os: false,
        path: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
      };
    }

    // Fix rpc-websockets resolution issue with @solana/web3.js sub-dependencies
    config.resolve.alias = {
      ...config.resolve.alias,
      'rpc-websockets/dist/lib/client': require.resolve('rpc-websockets/dist/lib/client.cjs'),
      'rpc-websockets/dist/lib/client/websocket': require.resolve('rpc-websockets/dist/lib/client/websocket.cjs'),
    };

    // Ignore node-specific modules in browser builds
    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []),
    ];

    return config;
  },
};

module.exports = nextConfig;
