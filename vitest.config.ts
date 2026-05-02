import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    test: {
      globals: true,
      environment: "node",
      testTimeout: 30000,
      hookTimeout: 30000,
      fileParallelism: false,
      env,
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.next/**",
        "**/.claude/worktrees/**",
      ],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
