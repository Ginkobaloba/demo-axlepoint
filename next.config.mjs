/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Next 15 graduated this out of `experimental`.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
