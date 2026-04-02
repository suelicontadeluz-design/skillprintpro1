/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sem 'output: export' — necessário para App Router + Server Components na Vercel
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
}

module.exports = nextConfig
