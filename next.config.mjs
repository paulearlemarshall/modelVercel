/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      "/api/models": ["./results_*.json"]
    }
  }
};

export default nextConfig;
