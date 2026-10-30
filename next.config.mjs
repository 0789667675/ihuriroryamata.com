/** @type {import('next').NextConfig} */

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ['pdfkit'],
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
