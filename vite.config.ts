// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { defineConfig } from 'vitest/config';

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    // The droplet's API server build (deploy/server.ts) doesn't need the game's images and music.
    copyPublicDir: !isSsrBuild,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
