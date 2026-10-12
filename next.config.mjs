/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ['pdfkit'],
  },
};

export default nextConfig;
