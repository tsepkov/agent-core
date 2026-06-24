/** @type {import('next').NextConfig} */
const nextConfig = {
  // Restate SDK and AI middleware use Node.js-specific APIs; exclude from bundling.
  serverExternalPackages: [
    "@restatedev/restate-sdk",
    "@restatedev/vercel-ai-middleware",
    "@openrouter/ai-sdk-provider",
  ],
};

export default nextConfig;
