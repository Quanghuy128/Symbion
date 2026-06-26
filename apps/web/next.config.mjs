/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Web is served by the daemon (static export) per STATE §8 #6.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
