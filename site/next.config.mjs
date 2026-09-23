/** @type {import('next').NextConfig} */
export default {
  // postgres.js and node:crypto are server-only; never bundle them for a browser.
  experimental: {
    serverComponentsExternalPackages: ["postgres"],
    serverActions: { bodySizeLimit: "1mb" },
  },
  webpack: (config) => {
    // The engine and worker are plain ESM run through tsx, where ".js"
    // extensions in relative imports are required. Next's bundler resolves
    // extensionless by default, so teach it the same mapping rather than
    // stripping extensions and breaking the worker.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
