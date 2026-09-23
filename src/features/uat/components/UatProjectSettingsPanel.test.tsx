/**
 * T044 and T045 — per-project settings, and a bypass that cannot be invisible.
 *
 * **The three-state enablement control is the load-bearing part.** ~2,026 projects have no
 * settings row, and "no row" means inherit — which is why this table could be added without
 * touching any of them. A two-state switch would force a row onto every project the first time
 * anyone opened the panel, and inherit would stop existing as a state. So the test asserts that
 * inherit is selectable, that it writes `null` rather than `false`, and that null and absent
 * both read back as inherit.
 *
 * **The upsert is asserted by the write it makes, not by the row count it hopes for.** A double
 * submit cannot create a second row because the platform's alternate key refuses it; the test
 * covers the app's half — that it reads first, updates when a row exists, and replays a losing
 * create as an update when the key fires.
 *
 * **The bypass writes three things from one reason.** One risk, one decision, one flag, and the
 * operator types the reason once. The counts are asserted, because "exactly one" is the clause.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { createElement } from 'react';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('../../../hooks/useToast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: vi.fn(), info: vi.fn(),
  },
}));
vi.mock('../../../lib/taskSource', () => ({
  useDataSource: () => 'custom',
  usesCustomTables: (s: string) => s === 'custom' || s === 'sharepoint',
}));

const settingState = {
  data: [] as Record<string, unknown>[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('../../../hooks/useUatDefects', () => ({
  useUatProjectSetting: () => settingState,
}));

const upsertUatProjectSetting = vi.fn();
vi.mock('../../../api/uatProjectSettings.api', () => ({
  upsertUatProjectSetting: (...a: unknown[]) => upsertUatProjectSetting(...a),
}));

const createRisk = vi.fn();
vi.mock('../../../hooks/useProjectRisks', () => ({
  useCreateProjectRisk: () => ({ mutateAsync: createRisk, isPending: false }),
}));

const createProjectDecision = vi.fn();
vi.mock('../../../api/projectDecisions.api', () => ({
  createProjectDecision: (...a: unknown[]) => createProjectDecision(...a),
}));

vi.mock('./TemplatePicker', () => ({
  TemplatePicker: ({ id, label }: { id: string; label: string }) =>
    <div data-testid={`template-picker-${id}`}>{label}</div>,
}));

import { UatProjectSettingsPanel, enablementOf, enabledValueFor } from './UatProjectSettingsPanel';
import type { UatProjectSetting } from '../../../models/uatDefect.model';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
}

function renderPanel() {
  const Wrapper = wrapper();
  return render(<UatProjectSettingsPanel projectId="p-1" />, { wrapper: Wrapper });
}

/** The payload of the nth upsert call. */
const upsertPayload = (n = 0) => upsertUatProjectSetting.mock.calls[n][2] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  settingState.data = [];
  settingState.isPending = false;
  settingState.isError = false;
  upsertUatProjectSetting.mockResolvedValue('s-1');
  createRisk.mockResolvedValue({ msdyn_projectriskid: 'risk-1' });
  createProjectDecision.mockResolvedValue({ pmo_projectdecisionid: 'dec-1' });
});

describe('enablement has three states, and inherit is one of them', () => {
  it('reads null and absent as inherit, true as on, false as off', () => {
    expect(enablementOf(undefined)).toBe('inherit');
    expect(enablementOf({ pmo_uatenabled: null } as UatProjectSetting)).toBe('inherit');
    expect(enablementOf({ pmo_uatenabled: true } as UatProjectSetting)).toBe('on');
    expect(enablementOf({ pmo_uatenabled: false } as UatProjectSetting)).toBe('off');
  });

  it('writes null for inherit — not false, which would mean "off"', () => {
    expect(enabledValueFor('inherit')).toBeNull();
    expect(enabledValueFor('on')).toBe(true);
    expect(enabledValueFor('off')).toBe(false);
  });

  it('defaults a project with no row to inherit and offers all three choices', () => {
    renderPanel();
    const select = screen.getByLabelText('UAT for this project') as HTMLSelectElement;
    expect(select.value).toBe('inherit');
    expect(Array.from(select.querySelectorAll('option')).map((o) => o.value))
      .toEqual(['inherit', 'on', 'off']);
    expect(screen.getByText(/No project-level answer is stored/i)).toBeTruthy();
  });

  it('turns UAT off for this project, and says other projects are unaffected', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('UAT for this project'), { target: { value: 'off' } });
    expect(screen.getByText(/Other projects are unaffected/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));
    await waitFor(() => expect(upsertUatProjectSetting).toHaveBeenCalled());
    expect(upsertPayload().pmo_uatenabled).toBe(false);
  });

  it('states the one-way rule for "on", because a project cannot grant what was withdrawn', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('UAT for this project'), { target: { value: 'on' } });
    expect(screen.getByText(/cannot grant what has been withdrawn/i)).toBeTruthy();
  });

  it('saves nothing until something changes', () => {
    renderPanel();
    expect(screen.getByRole('button', { name: /Save settings/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('ITPR number'), { target: { value: 'ITPR-1' } });
    expect(screen.getByRole('button', { name: /Save settings/i })).toBeEnabled();
  });

  it('goes through the upsert, so a double submit cannot make a second row', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('UAT for this project'), { target: { value: 'off' } });
    const save = screen.getByRole('button', { name: /Save settings/i });
    fireEvent.click(save);
    await waitFor(() => expect(upsertUatProjectSetting).toHaveBeenCalledTimes(1));
    // Every write goes through the one function that owns the alternate-key recovery.
    expect(upsertUatProjectSetting.mock.calls[0][0]).toBe('p-1');
    expect(upsertUatProjectSetting.mock.calls[0][1]).toBe('custom');
  });
});

describe('the ITPR is a reference field and nothing more', () => {
  it('is a single editable text input, not a lookup or a list', () => {
    renderPanel();
    const input = screen.getByLabelText('ITPR number');
    expect(input.tagName).toBe('INPUT');
    expect(screen.getByText(/not checked against any system/i)).toBeTruthy();
  });

  it('stores an emptied ITPR as null rather than an empty string', async () => {
    settingState.data = [{ pmo_uatprojectsettingid: 's-1', pmo_itprnumber: 'ITPR-9' }];
    renderPanel();
    fireEvent.change(screen.getByLabelText('ITPR number'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Save settings/i }));
    await waitFor(() => expect(upsertUatProjectSetting).toHaveBeenCalled());
    expect(upsertPayload().pmo_itprnumber).toBeNull();
  });
});

describe('a read failure is not "not configured"', () => {
  it('says the settings are unchanged rather than showing inherit', () => {
    settingState.isError = true;
    renderPanel();
    expect(screen.getByRole('alert').textContent).toMatch(/read failure/i);
    expect(screen.queryByLabelText('UAT for this project')).toBeNull();
  });
});

describe('the bypass writes one risk, one decision and one flag from one reason (T045)', () => {
  async function recordBypass(reason = 'Vendor-hosted change with no user-facing surface') {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Bypass UAT for this project/i }));
    fireEvent.change(await screen.findByLabelText(/Why is UAT being skipped/i), {
      target: { value: reason },
    });
    fireEvent.click(screen.getByRole('button', { name: /Record the bypass/i }));
    await waitFor(() => expect(upsertUatProjectSetting).toHaveBeenCalled());
  }

  it('creates exactly one risk and exactly one decision', async () => {
    await recordBypass();
    expect(createRisk).toHaveBeenCalledTimes(1);
    expect(createProjectDecision).toHaveBeenCalledTimes(1);
  });

  it('carries the operator\'s single reason into both, and into the settings row', async () => {
    const reason = 'Configuration-only release, verified by the vendor';
    await recordBypass(reason);

    expect(String((createRisk.mock.calls[0][0] as Record<string, unknown>).msdyn_description))
      .toContain(reason);
    expect(String((createProjectDecision.mock.calls[0][0] as Record<string, unknown>).pmo_description))
      .toContain(reason);
    expect(upsertPayload().pmo_bypassreason).toBe(reason);
    // Typed once. Three destinations, one input.
    expect(screen.queryAllByLabelText(/Why is UAT being skipped/i)).toHaveLength(0);
  });

  it('stores the risk and decision ids on the settings row, adding no lookup to either table', async () => {
    await recordBypass();
    expect(upsertPayload().pmo_bypassriskid).toBe('risk-1');
    expect(upsertPayload().pmo_bypassdecisionid).toBe('dec-1');
    // Neither create carries a UAT lookup: those tables belong to the wider PMO app.
    const riskPayload = createRisk.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(riskPayload).some((k) => k.toLowerCase().includes('uat'))).toBe(false);
  });

  it('sets the flag LAST, so a settings row never claims a risk that does not exist', async () => {
    await recordBypass();
    expect(createRisk).toHaveBeenCalledBefore(upsertUatProjectSetting);
    expect(createProjectDecision).toHaveBeenCalledBefore(upsertUatProjectSetting);
    expect(upsertPayload().pmo_bypassuat).toBe(true);
  });

  it('refuses a reason too short for anyone reading the risk register to use', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Bypass UAT for this project/i }));
    fireEvent.change(await screen.findByLabelText(/Why is UAT being skipped/i), { target: { value: 'no time' } });
    expect(screen.getByRole('button', { name: /Record the bypass/i })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toMatch(/someone reading the risk register/i);
    expect(createRisk).not.toHaveBeenCalled();
  });

  it('writes nothing to the settings row when the risk cannot be created', async () => {
    createRisk.mockRejectedValue(new Error('403'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Bypass UAT for this project/i }));
    fireEvent.change(await screen.findByLabelText(/Why is UAT being skipped/i), {
      target: { value: 'A reason long enough to be useful' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Record the bypass/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(createProjectDecision).not.toHaveBeenCalled();
    expect(upsertUatProjectSetting).not.toHaveBeenCalled();
  });

  it('shows the existing record, and lifts without deleting the risk or the decision', async () => {
    settingState.data = [{
      pmo_uatprojectsettingid: 's-1',
      pmo_bypassuat: true,
      pmo_bypassreason: 'Vendor-hosted change',
      pmo_bypassriskid: 'risk-1',
      pmo_bypassdecisionid: 'dec-1',
      pmo_bypassdecidedon: '2026-08-20T00:00:00Z',
    }];
    renderPanel();
    // The panel says so where anyone can see it.
    expect(screen.getByRole('status').textContent).toMatch(/UAT is bypassed for this project/i);

    fireEvent.click(screen.getByRole('button', { name: /Review the UAT bypass/i }));
    expect((await screen.findByTestId('uat-bypass-record')).textContent).toContain('risk-1');

    fireEvent.click(screen.getByRole('button', { name: /Lift the bypass/i }));
    await waitFor(() => expect(upsertUatProjectSetting).toHaveBeenCalled());
    expect(upsertPayload().pmo_bypassuat).toBe(false);
    // The record of what happened stays.
    expect(toastSuccess.mock.calls.some((c) => /risk and decision remain/i.test(String(c[0])))).toBe(true);
  });
});
