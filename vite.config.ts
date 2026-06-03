// @lovable.dev/vite-tanstack-config already includes the following -- do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { execSync } from "node:child_process";
import { nitro } from "nitro/vite";

function safeGit(cmd: string, fallback: string) {
  try {
    return (
      execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim() || fallback
    );
  } catch {
    return fallback;
  }
}

const BUILD_BRANCH =
  process.env.VITE_BUILD_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  process.env.CF_PAGES_BRANCH ||
  safeGit("git rev-parse --abbrev-ref HEAD", "unknown");

const BUILD_COMMIT =
  process.env.VITE_BUILD_COMMIT ||
  process.env.GITHUB_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  safeGit("git rev-parse HEAD", "unknown");

const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [nitro({ preset: "vercel" })],
  vite: {
    define: {
      __BUILD_BRANCH__: JSON.stringify(BUILD_BRANCH),
      __BUILD_COMMIT__: JSON.stringify(BUILD_COMMIT),
      __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    },
  },
});
