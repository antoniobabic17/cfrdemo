/// <reference types="vite/client" />

/**
 * Build-time constant injected by vite.config.ts. Value is the short
 * git commit SHA (e.g. "1f8bbe1"), or "dev" when git isn't available.
 * Used in the AppShell header so screenshots always show which app
 * revision the user is on.
 */
declare const __APP_VERSION__: string;

/**
 * Human-readable semantic version injected by vite.config.ts, sourced from
 * package.json (e.g. "2.0.0"). Maps to the git SHA in __APP_VERSION__.
 * Shown in the AppShell hover tooltip; see CHANGELOG.md for release notes.
 */
declare const __APP_SEMVER__: string;
