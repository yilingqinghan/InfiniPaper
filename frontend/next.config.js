/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    return [
      { source: '/js/:path*', destination: '/ccfddl/js/:path*' },
      { source: '/css/:path*', destination: '/ccfddl/css/:path*' },
      { source: '/fonts/:path*', destination: '/ccfddl/fonts/:path*' },
      { source: '/conference/:path*', destination: '/ccfddl/conference/:path*' },
      { source: "/files/:path*", destination: `${backend}/files/:path*` },
    ];
  },
};

module.exports = nextConfig;