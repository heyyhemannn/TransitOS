/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@stms/types'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    typedRoutes: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Proxy API calls to Express backend in development
  async rewrites() {
    return process.env.NODE_ENV === 'development'
      ? [
          {
            source: '/api/v1/:path*',
            destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/:path*`,
          },
        ]
      : [];
  },
};

module.exports = nextConfig;
