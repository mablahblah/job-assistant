import path from "path";
import { fileURLToPath } from "url";

// __dirname equivalent for ESM — needed because next.config.mjs is an ES module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Explicit root prevents Next.js picking up lockfiles from parent directories
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
