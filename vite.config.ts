// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { defineConfig } from 'vitest/config';

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    // The Cloudflare Worker build (npm run build:worker, deploy/worker.ts) doesn't need the game's images and music.
    copyPublicDir: !isSsrBuild,
    rollupOptions: isSsrBuild ? { external: [/^node:/, /^cloudflare:/] } : undefined,
  },
  // The Worker build: one file for Cloudflare's runtime (Vite resolves import.meta.glob, which the
  // NASA snapshot loader uses; Wrangler then deploys the result).
  ssr: isSsrBuild ? { target: 'webworker', noExternal: true } : undefined,
  test: {
    include: ['src/**/*.test.ts'],
    // The balance reports and no-free-choice proofs simulate hundreds of missions: give them room
    // so a busy machine doesn't turn a slow run into a false failure.
    testTimeout: 30000,
  },
}));
