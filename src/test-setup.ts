import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ResizeObserver is used by Fluent UI MessageBar but is not available in jsdom
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock @microsoft/power-apps submodules — the SDK communicates through the Power
// Platform bridge which is unavailable in the test environment. All API modules are
// mocked individually in their own test files; this prevents transitive import failures.
vi.mock('@microsoft/power-apps/data', () => ({
  getClient: () => ({
    createRecordAsync: vi.fn(),
    updateRecordAsync: vi.fn(),
    deleteRecordAsync: vi.fn(),
    retrieveRecordAsync: vi.fn(),
    retrieveMultipleRecordsAsync: vi.fn(),
    executeAsync: vi.fn(),
    uploadFileToRecord: vi.fn(),
    downloadFileFromRecord: vi.fn(),
    downloadImageFromRecord: vi.fn(),
    deleteFileOrImageFromRecord: vi.fn(),
  }),
}));

vi.mock('@microsoft/power-apps/app', () => ({
  getContext: () => ({
    parameters: {},
    mode: { isControlDisabled: false, isVisible: true },
    client: { getFormFactor: () => 1 },
    navigation: { openUrl: vi.fn() },
    utils: { getEntityMetadata: vi.fn() },
  }),
}));
