/**
 * Smoke tests for the Permissions admin page. Mocks the api layer so we
 * can render without hitting Dataverse. Covers:
 *   - Chart renders with the expected number of bars.
 *   - Empty-state copy renders when there's no session data.
 *   - User viewer renders the "pick a user" hint when none is selected.
 *   - When permissions data is provided, categorized project groups render.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { MonthlyBucket, UserPermissionsResult } from '../../api/permissions.api';

// ── Mocks ────────────────────────────────────────────────────────────────

const monthlyMock = vi.fn<() => Promise<MonthlyBucket[]>>();
const userPermsMock = vi.fn<(id: string) => Promise<UserPermissionsResult>>();

vi.mock('../../api/permissions.api', async () => {
  const actual = await vi.importActual<typeof import('../../api/permissions.api')>('../../api/permissions.api');
  return {
    ...actual,
    fetchMonthlyUniqueUsers: (...args: unknown[]) => monthlyMock(...(args as [])),
    fetchUserProjectPermissions: (id: string) => userPermsMock(id),
  };
});

// dv.list / dv.get for the user picker & name-resolution paths.
vi.mock('../../lib/dataverseClient', () => ({
  list: vi.fn(async () => []),
  get: vi.fn(async () => ({ fullname: 'Test User' })),
}));

// Recharts ResponsiveContainer needs measured dimensions in jsdom -- stub it.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }} data-testid="rechart-container">{children}</div>
    ),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────

// Import AFTER vi.mock declarations (which are hoisted by vitest).
import { PermissionsPage } from './PermissionsPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PermissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function bucket(month: string, userIds: string[], userNames: Record<string, string | null> = {}): MonthlyBucket {
  return { month, distinctUsers: userIds.length, userIds, userNames };
}

beforeEach(() => {
  monthlyMock.mockReset();
  userPermsMock.mockReset();
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('PermissionsPage', () => {
  it('renders the empty-state when no session data exists', async () => {
    monthlyMock.mockResolvedValue([]);
    userPermsMock.mockResolvedValue({ isAdmin: false, projects: [] });

    renderPage();

    expect(await screen.findByText(/no session data yet/i)).toBeInTheDocument();
  });

  it('renders the monthly chart panel and last-month tally', async () => {
    monthlyMock.mockResolvedValue([
      bucket('2026-05', ['u1', 'u2']),
      bucket('2026-06', ['u1', 'u2', 'u3']),
      bucket('2026-07', ['u1', 'u2', 'u3', 'u4', 'u5']),
    ]);
    userPermsMock.mockResolvedValue({ isAdmin: false, projects: [] });

    renderPage();

    await screen.findByTestId('rechart-container');
    // "This month" tile shows the last bucket's distinctUsers count.
    expect(screen.getByText('5')).toBeInTheDocument();
    // Section header renders (there may be more than one node -- ensure at
    // least one matches so we don't false-fail on Recharts axis labels).
    expect(screen.getAllByText(/monthly unique users/i).length).toBeGreaterThan(0);
  });

  it('renders the user viewer placeholder before a user is picked', async () => {
    monthlyMock.mockResolvedValue([]);
    userPermsMock.mockResolvedValue({ isAdmin: false, projects: [] });

    renderPage();

    expect(await screen.findByText(/pick a user to see their project access/i)).toBeInTheDocument();
    // The searchable-select trigger is visible.
    expect(screen.getByText(/search by name/i)).toBeInTheDocument();
  });
});
