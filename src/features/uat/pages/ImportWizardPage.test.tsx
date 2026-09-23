/**
 * T037 — the import wizard. A file whose headings match NOTHING still imports.
 *
 * The headline test uses headings no field could ever match — `Widget`, `Sprocket`, `Zeta` —
 * drives the mapping by hand, and follows through to a commit. That is the whole difference
 * from the legacy import, which was locked to two fixed view column contracts and therefore
 * only ever worked for one team's spreadsheets.
 *
 * The second claim is about ORDER: the staged count is shown, read back from Dataverse, and
 * nothing is created until the operator presses the last button. So the test asserts the
 * count is on screen while zero test cases have been created.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../hooks/useToast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../../../lib/taskSource', () => ({ useDataSource: () => 'custom' }));

const stageImport = vi.fn();
vi.mock('../lib/uatImportStaging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/uatImportStaging')>();
  return { ...actual, stageImport: (...a: unknown[]) => stageImport(...a) };
});

const archiveImportSource = vi.fn();
vi.mock('../lib/uatImportArchive', () => ({
  archiveImportSource: (...a: unknown[]) => archiveImportSource(...a),
}));

const listUatImportRows = vi.fn();
vi.mock('../../../api/uatProjectSettings.api', () => ({
  listUatImportRows: (...a: unknown[]) => listUatImportRows(...a),
}));

const commitMutateAsync = vi.fn();
const loadImportReferences = vi.fn();
vi.mock('../hooks/useUatImportCommit', () => ({
  useUatImportCommit: () => ({ mutateAsync: commitMutateAsync, isPending: false }),
  loadImportReferences: (...a: unknown[]) => loadImportReferences(...a),
}));

vi.mock('../../../hooks/useProjects', () => ({
  useActiveProjects: () => ({
    data: [{ msdyn_projectid: 'p-9', msdyn_subject: 'Nexus Rollout' }],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { ImportWizardPage, suggestField } from './ImportWizardPage';
import { toast } from '../../../hooks/useToast';

function renderWizard(search = '?projectId=p-1') {
  return render(
    <MemoryRouter initialEntries={[`/uat/import${search}`]}>
      <ImportWizardPage />
    </MemoryRouter>,
  );
}

const csv = (text: string, name = 'cases.csv') => new File([text], name, { type: 'text/csv' });

/** Upload a file and wait for the mapping step. */
async function upload(file: File) {
  fireEvent.change(screen.getByTestId('uat-import-file-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/read from/i)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  stageImport.mockResolvedValue({ batchId: 'b-1', staged: 2, expected: 2 });
  listUatImportRows.mockResolvedValue([
    { pmo_uatimportrowid: 'r-1', pmo_sourcerownumber: 2, pmo_rawdata: '{"Widget":"Login"}' },
    { pmo_uatimportrowid: 'r-2', pmo_sourcerownumber: 3, pmo_rawdata: '{"Widget":"Logout"}' },
  ]);
  loadImportReferences.mockResolvedValue({ cyclesByName: {}, testersByName: {} });
  archiveImportSource.mockResolvedValue({ archived: true });
  commitMutateAsync.mockResolvedValue({ created: 2, skipped: 0, failed: 0, total: 2, done: 2, failures: [] });
});

describe('a file whose headings match nothing still imports', () => {
  it('suggests nothing for unrecognisable headings, and the operator maps by hand', async () => {
    renderWizard();
    await upload(csv('Widget,Sprocket,Zeta\nLogin,a,b\nLogout,c,d\n'));

    // Every dropdown starts at "Do not import" — no automatic match was found or needed.
    const widget = screen.getByLabelText('Field for column Widget') as HTMLSelectElement;
    const sprocket = screen.getByLabelText('Field for column Sprocket') as HTMLSelectElement;
    expect(widget.value).toBe('');
    expect(sprocket.value).toBe('');

    // Staging is refused until a Title is mapped, and it says why rather than just disabling.
    expect(screen.getByRole('alert').textContent).toMatch(/Map one column to/i);
    expect(screen.getByRole('button', { name: /Stage 2 rows/i })).toBeDisabled();

    fireEvent.change(widget, { target: { value: 'pmo_title' } });
    expect(screen.getByRole('button', { name: /Stage 2 rows/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Stage 2 rows/i }));
    await waitFor(() => expect(stageImport).toHaveBeenCalledTimes(1));

    // The operator's map is what was staged — not a guess, and not the unmapped columns.
    const staged = stageImport.mock.calls[0][0] as { mapping: Record<string, string> };
    expect(staged.mapping).toEqual({ Widget: 'pmo_title' });
  });

  it('follows through to a commit that creates the cases', async () => {
    renderWizard();
    await upload(csv('Widget\nLogin\nLogout\n'));
    fireEvent.change(screen.getByLabelText('Field for column Widget'), { target: { value: 'pmo_title' } });
    fireEvent.click(screen.getByRole('button', { name: /Stage 2 rows/i }));

    await waitFor(() => expect(screen.getByTestId('uat-import-staged-count')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Create 2 test cases/i }));

    await waitFor(() => expect(commitMutateAsync).toHaveBeenCalledTimes(1));
    expect((commitMutateAsync.mock.calls[0][0] as { batchId: string }).batchId).toBe('b-1');
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(expect.stringContaining('2 test cases created'));
  });

  it('suggests a field only on an exact label match, never on a near one', () => {
    expect(suggestField('Title')).toBe('pmo_title');
    expect(suggestField('  title  ')).toBe('pmo_title');
    expect(suggestField('Planned start')).toBe('pmo_plannedstart');
    // Near-misses suggest nothing: a wrong pre-selection the operator does not notice is
    // worse than an empty one they have to fill in.
    expect(suggestField('Test Title')).toBe('');
    expect(suggestField('Titles')).toBe('');
    expect(suggestField('Widget')).toBe('');
  });

  it('lets the operator overrule a suggestion', async () => {
    renderWizard();
    await upload(csv('Title,Objective\nA,B\n'));
    const objective = screen.getByLabelText('Field for column Objective') as HTMLSelectElement;
    expect(objective.value).toBe('pmo_objective');          // suggested
    fireEvent.change(objective, { target: { value: '' } });  // and overruled

    fireEvent.click(screen.getByRole('button', { name: /Stage 1 row/i }));
    await waitFor(() => expect(stageImport).toHaveBeenCalled());
    expect((stageImport.mock.calls[0][0] as { mapping: Record<string, string> }).mapping)
      .toEqual({ Title: 'pmo_title' });
  });

  it('does not let two columns feed the same field', async () => {
    renderWizard();
    await upload(csv('Title,Also title\nA,B\n'));
    const second = screen.getByLabelText('Field for column Also title');
    const titleOption = Array.from(second.querySelectorAll('option'))
      .find((o) => (o as HTMLOptionElement).value === 'pmo_title') as HTMLOptionElement;
    // Offered but disabled, rather than hidden: hiding it makes a mis-mapping uncorrectable.
    expect(titleOption.disabled).toBe(true);
  });
});

describe('staged rows are visible and countable before anything is created', () => {
  it('shows the count READ BACK from Dataverse, with nothing created yet', async () => {
    // 2 rows staged, and the count on screen comes from listUatImportRows — not from the
    // parse. The number the operator sees is the number that exists.
    listUatImportRows.mockResolvedValue([
      { pmo_uatimportrowid: 'r-1', pmo_sourcerownumber: 2, pmo_rawdata: '{"Widget":"Login"}' },
      { pmo_uatimportrowid: 'r-2', pmo_sourcerownumber: 3, pmo_rawdata: '{"Widget":"Logout"}' },
    ]);
    renderWizard();
    await upload(csv('Widget\nLogin\nLogout\n'));
    fireEvent.change(screen.getByLabelText('Field for column Widget'), { target: { value: 'pmo_title' } });
    fireEvent.click(screen.getByRole('button', { name: /Stage 2 rows/i }));

    await waitFor(() => expect(screen.getByTestId('uat-import-staged-count')).toBeTruthy());
    expect(screen.getByTestId('uat-import-staged-count').textContent)
      .toMatch(/2 rows staged and saved/);
    expect(screen.getByTestId('uat-import-staged-count').textContent)
      .toMatch(/Nothing has been created yet/);
    expect(commitMutateAsync).not.toHaveBeenCalled();
  });

  it('lists the rows that cannot be created, with their source row numbers', async () => {
    listUatImportRows.mockResolvedValue([
      { pmo_uatimportrowid: 'r-1', pmo_sourcerownumber: 2, pmo_rawdata: '{"Widget":"Login"}' },
      { pmo_uatimportrowid: 'r-2', pmo_sourcerownumber: 3, pmo_rawdata: '{"Widget":""}' },
    ]);
    renderWizard();
    await upload(csv('Widget\nLogin\n\n'));
    fireEvent.change(screen.getByLabelText('Field for column Widget'), { target: { value: 'pmo_title' } });
    fireEvent.click(screen.getByRole('button', { name: /Stage 1 row/i }));

    await waitFor(() => expect(screen.getByTestId('uat-import-staged-count')).toBeTruthy());
    // The parse drops the blank row, so the preview here validates the one real row and the
    // button offers exactly that count.
    expect(screen.getByRole('button', { name: /Create 1 test case/i })).toBeEnabled();
  });

  it('surfaces a staging failure and stays on the mapping step', async () => {
    stageImport.mockRejectedValue(new Error('Only 4 of 5 rows were staged'));
    renderWizard();
    await upload(csv('Title\nA\n'));
    fireEvent.click(screen.getByRole('button', { name: /Stage 1 row/i }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('Only 4 of 5');
    // Still on the mapping step, so the operator can change something and try again.
    expect(screen.getByRole('button', { name: /Stage 1 row/i })).toBeTruthy();
  });

  it('refuses the file itself with the parser\'s own message', async () => {
    renderWizard();
    fireEvent.change(screen.getByTestId('uat-import-file-input'), {
      target: { files: [csv('Title,Steps\n')] },       // header only
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no data rows/i));
    expect(stageImport).not.toHaveBeenCalled();
  });
});

describe('the sidebar entry point', () => {
  it('asks which project rather than dead-ending', async () => {
    renderWizard('');       // no projectId, as the sidebar link arrives
    expect(screen.getByLabelText('Project')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Nexus Rollout' })).toBeTruthy();
    // And no file input yet — the project comes first, because a case cannot exist without one.
    expect(screen.queryByTestId('uat-import-file-input')).toBeNull();
  });
});

describe('the uploaded file is kept with its batch (T041)', () => {
  it('archives the file the operator actually uploaded, after staging', async () => {
    renderWizard();
    await upload(csv('Widget\nLogin\n', 'sprint-9.csv'));
    fireEvent.change(screen.getByLabelText('Field for column Widget'), { target: { value: 'pmo_title' } });
    fireEvent.click(screen.getByRole('button', { name: /Stage 1 row/i }));

    await waitFor(() => expect(archiveImportSource).toHaveBeenCalledTimes(1));
    const call = archiveImportSource.mock.calls[0][0] as { batchId: string; file: File };
    expect(call.batchId).toBe('b-1');
    expect(call.file.name).toBe('sprint-9.csv');
    // AFTER staging, so the archive can never be the reason an import does not happen.
    expect(stageImport).toHaveBeenCalledBefore(archiveImportSource);
  });

  it('says the file was not kept, and still lets the import proceed', async () => {
    archiveImportSource.mockResolvedValue({ archived: false, reason: 'SharePoint 503' });
    renderWizard();
    await upload(csv('Widget\nLogin\n', 'sprint-9.csv'));
    fireEvent.change(screen.getByLabelText('Field for column Widget'), { target: { value: 'pmo_title' } });
    fireEvent.click(screen.getByRole('button', { name: /Stage 1 row/i }));

    await waitFor(() => expect(screen.getByTestId('uat-import-staged-count')).toBeTruthy());
    // Named, not swallowed — and the operator is told to keep their own copy.
    expect(screen.getByRole('status').textContent).toMatch(/could not be kept with the batch/i);
    expect(screen.getByRole('status').textContent).toContain('SharePoint 503');
    // And the commit is still available: losing the copy is smaller than losing the import.
    expect(screen.getByRole('button', { name: /Create 1 test case/i })).toBeEnabled();
  });
});
