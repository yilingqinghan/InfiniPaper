/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/js/:path*', destination: '/ccfddl/js/:path*' },
      { source: '/css/:path*', destination: '/ccfddl/css/:path*' },
      { source: '/fonts/:path*', destination: '/ccfddl/fonts/:path*' },
      { source: '/conference/:path*', destination: '/ccfddl/conference/:path*' },
    ];
  },
};

module.exports = nextConfig;