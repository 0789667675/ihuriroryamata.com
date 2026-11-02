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
    outputFileTracingIncludes: {
      '/api/ukwezi/pdf': ['./node_modules/pdfkit/js/standard-fonts/**/*'],
    },
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
