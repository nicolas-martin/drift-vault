const webpack = require('webpack');
const path = require('path');
const { loadEnvConfig } = require('@next/env');

// Force-load .env.local before Next.js config runs
loadEnvConfig(process.cwd());

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

		// The newer rpc-websockets package removed dist/lib/client and
		// dist/lib/client/websocket paths. Older @solana/web3.js copies
		// nested inside Drift SDKs still import those paths.
		// Redirect them to the top-level rpc-websockets browser bundle.
		const rpcWsBrowser = path.resolve(
			__dirname,
			'node_modules/rpc-websockets/dist/index.browser.cjs'
		);

		config.resolve.alias = {
			...config.resolve.alias,
			'rpc-websockets/dist/lib/client': rpcWsBrowser,
			'rpc-websockets/dist/lib/client/websocket': rpcWsBrowser,
			'rpc-websockets/dist/lib/client/websocket.cjs': rpcWsBrowser,
		};

		return config;
	},
};

module.exports = nextConfig;
