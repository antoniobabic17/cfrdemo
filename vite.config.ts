import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Compute a short human-readable version string at BUILD TIME so screenshots
 * from users always show which app revision they're on. Prefers the current
 * git commit SHA (short, 7 chars) and falls back to a placeholder if git
 * isn't available at build time (e.g. some CI environments).
 */
function computeAppVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (sha) return sha
  } catch { /* fall through */ }
  return 'dev'
}

const APP_VERSION = computeAppVersion()

/**
 * Human-readable semantic version. Sourced from package.json's `version` field
 * so bumping the release version is a one-line change there. The git SHA
 * (APP_VERSION) stays the primary build fingerprint shown in the UI; this
 * semver maps to it behind the scenes (see CHANGELOG.md).
 */
function computeAppSemver(): string {
  try {
    const pkgPath = fileURLToPath(new URL('./package.json', import.meta.url))
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const APP_SEMVER = computeAppSemver()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  server: {
    port: 3000,
  },
  define: {
    // Injected at build time — read via `__APP_VERSION__` in TSX. Kept as a
    // plain string literal (JSON-stringified) so the value is inlined into
    // the bundle and requires no runtime lookup.
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // Human-readable semver from package.json (e.g. "2.0.0"). Maps to the
    // SHA build fingerprint above; surfaced in the AppShell hover tooltip.
    __APP_SEMVER__: JSON.stringify(APP_SEMVER),
  },
})
