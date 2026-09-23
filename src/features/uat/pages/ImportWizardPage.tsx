/**
 * ImportWizardPage — four steps, and the operator's own mapping decides everything.
 *
 * **A file whose headings match nothing still imports.** The legacy import was locked to two
 * fixed view column contracts, which is exactly what confined it to one claim-testing domain
 * and made it useless to everyone else. Here the mapping is a control the operator fills in.
 * An exact case-insensitive label match pre-selects a field as a SUGGESTION, and nothing
 * depends on it: with zero matches every dropdown simply starts at "Do not import", the
 * operator picks, and the commit reads their choice. A test drives a file whose headings match
 * nothing at all through to a committed import.
 *
 * **The staged rows are visible and countable before the commit.** Step 3 shows the count that
 * Dataverse holds — read back, not the parse count — beside the rows that will be created and
 * the rows that cannot be, each with its source row number. That order is the point: staging
 * is durable and complete first, the operator sees the numbers, and only then does anything get
 * created.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useActiveProjects } from '../../../hooks/useProjects';
import { Upload, ArrowLeft, ArrowRight, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Label } from '../../../components/ui/label';
import { toast } from '../../../hooks/useToast';
import { useDataSource } from '../../../lib/taskSource';
import { parseImportFile, UatParseError, type ParsedSheet } from '../lib/uatFileParse';
import { stageImport, UatStagingError } from '../lib/uatImportStaging';
import { archiveImportSource } from '../lib/uatImportArchive';
import {
  IMPORT_TARGET_FIELDS,
  validateStagedRows,
  type ImportReferences,
} from '../lib/uatImportValidation';
import {
  useUatImportCommit,
  loadImportReferences,
  type CommitProgress,
} from '../hooks/useUatImportCommit';
import { listUatImportRows } from '../../../api/uatProjectSettings.api';

/** The value a dropdown carries when a heading feeds nothing. */
const NOT_IMPORTED = '';

type Step = 'file' | 'map' | 'review' | 'done';

/**
 * A suggested field for a heading — exact label match only, case- and space-insensitive.
 *
 * Deliberately not fuzzy. A near-match ("Test Title" → Objective) that the operator does not
 * notice is worse than no suggestion at all, and the acceptance requires that nothing depend
 * on a match being found.
 */
export function suggestField(heading: string): string {
  const wanted = heading.trim().toLowerCase();
  const hit = IMPORT_TARGET_FIELDS.find((spec) => spec.label.toLowerCase() === wanted);
  return hit ? hit.field : NOT_IMPORTED;
}

export function ImportWizardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const dataSource = useDataSource();

  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parsing, setParsing] = useState(false);
  const [staging, setStaging] = useState(false);
  const [stagedCount, setStagedCount] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [references, setReferences] = useState<ImportReferences | null>(null);
  const [progress, setProgress] = useState<CommitProgress | null>(null);
  const [archiveWarning, setArchiveWarning] = useState<string | null>(null);

  const commit = useUatImportCommit(projectId);

  /** The mapping the operator has actually chosen — headings feeding a real field. */
  const activeMapping = useMemo(
    () => Object.fromEntries(Object.entries(mapping).filter(([, field]) => field !== NOT_IMPORTED)),
    [mapping],
  );

  /** What the commit would do, computed from the staged rows the operator can see. */
  const preview = useMemo(() => {
    if (!sheet || !references) return null;
    return validateStagedRows(
      sheet.rows.map((row) => ({ ...row })),
      activeMapping,
      references,
    );
  }, [sheet, references, activeMapping]);

  async function handleFile(picked: File | undefined) {
    if (!picked) return;
    setParsing(true);
    setParseError(null);
    setSheet(null);
    try {
      const parsed = await parseImportFile(picked);
      setFile(picked);
      setSheet(parsed);
      // Suggestions, not decisions. Every heading gets an entry so the UI is complete.
      setMapping(Object.fromEntries(parsed.headers.map((h) => [h, suggestField(h)])));
      setStep('map');
    } catch (error) {
      setParseError(
        error instanceof UatParseError
          ? error.message
          : `"${picked.name}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleStage() {
    if (!sheet || !file || !projectId) return;
    setStaging(true);
    try {
      const result = await stageImport({
        sheet, projectId, dataSource, fileName: file.name, mapping: activeMapping,
      });
      setBatchId(result.batchId);
      // The uploaded file is kept with its batch (T041). AFTER staging, so the archive can
      // never be the reason an import does not happen, and non-fatally for the same reason —
      // archiveImportSource returns an outcome rather than throwing.
      const archive = await archiveImportSource({
        batchId: result.batchId, file, dataSource,
      });
      setArchiveWarning(archive.archived ? null : archive.reason);
      // Read back from Dataverse, not taken from the parse — the number the operator sees is
      // the number that exists.
      const rows = await listUatImportRows(result.batchId);
      setStagedCount(rows.length);
      setReferences(await loadImportReferences(projectId, rows.map((row) => ({
        values: JSON.parse(row.pmo_rawdata ?? '{}') as Record<string, string>,
      })), activeMapping));
      setStep('review');
    } catch (error) {
      toast.error(
        error instanceof UatStagingError || error instanceof Error
          ? error.message
          : 'The rows could not be staged.',
        { action: 'stage a UAT import', parentProjectId: projectId },
      );
    } finally {
      setStaging(false);
    }
  }

  async function handleCommit() {
    if (!batchId) return;
    try {
      const summary = await commit.mutateAsync({ batchId, onProgress: setProgress });
      setStep('done');
      toast.success(
        `${summary.created} test case${summary.created === 1 ? '' : 's'} created`
        + (summary.skipped > 0 ? `, ${summary.skipped} skipped` : '')
        + (summary.failed > 0 ? `, ${summary.failed} failed` : '') + '.',
      );
    } catch {
      // useAppMutation has toasted and logged it; the operator stays on the review step with
      // the batch intact so they can retry.
    }
  }

  const mappedFields = Object.values(activeMapping);
  const titleMapped = mappedFields.includes('pmo_title');

  if (!projectId) return <ChooseProject />;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Import test cases</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a spreadsheet, say which column feeds which field, review what will be created,
          then create it. Nothing is created until you press the button on the last step.
        </p>
      </div>

      {/* ── Step 1: the file ─────────────────────────────────────────────── */}
      {step === 'file' && (
        <section className="space-y-3" aria-label="Choose a file">
          <input
            id="uat-import-file"
            type="file"
            accept=".xlsx,.csv"
            data-testid="uat-import-file-input"
            onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <p className="text-xs text-muted-foreground">
            .xlsx or .csv. Any column headings — you map them yourself on the next step.
          </p>
          {parsing && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the file…
            </p>
          )}
          {parseError && (
            <p className="text-sm text-destructive" role="alert">{parseError}</p>
          )}
        </section>
      )}

      {/* ── Step 2: the mapping ──────────────────────────────────────────── */}
      {step === 'map' && sheet && (
        <section className="space-y-4" aria-label="Map columns">
          <p className="text-sm">
            <strong>{sheet.rows.length}</strong> row{sheet.rows.length === 1 ? '' : 's'} read from{' '}
            <strong>{file?.name}</strong>
            {sheet.sheetName ? ` (sheet "${sheet.sheetName}")` : ''}.
          </p>

          {sheet.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 space-y-1" role="status">
              {sheet.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {warning}
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2">
            {sheet.headers.map((heading) => (
              <div key={heading} className="grid grid-cols-2 gap-3 items-center">
                <Label htmlFor={`map-${heading}`} className="truncate" title={heading}>
                  {heading}
                </Label>
                <select
                  id={`map-${heading}`}
                  aria-label={`Field for column ${heading}`}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={mapping[heading] ?? NOT_IMPORTED}
                  onChange={(e) => setMapping((m) => ({ ...m, [heading]: e.target.value }))}
                >
                  <option value={NOT_IMPORTED}>Do not import</option>
                  {IMPORT_TARGET_FIELDS.map((spec) => (
                    <option
                      key={spec.field}
                      value={spec.field}
                      // A field already taken by another column is offered but marked, rather
                      // than hidden: hiding it makes a mis-mapping impossible to correct.
                      disabled={mappedFields.includes(spec.field) && mapping[heading] !== spec.field}
                    >
                      {spec.label}{spec.required ? ' (required)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {!titleMapped && (
            <p className="text-sm text-destructive" role="alert">
              Map one column to <strong>Title</strong> — a test case cannot be created without one.
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setStep('file'); setSheet(null); }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Choose another file
            </Button>
            <Button onClick={() => void handleStage()} disabled={!titleMapped || staging}>
              {staging
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                : <Upload className="mr-1.5 h-4 w-4" aria-hidden />}
              Stage {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'}
            </Button>
          </div>
        </section>
      )}

      {/* ── Step 3: review, with the staged count read back ──────────────── */}
      {step === 'review' && sheet && (
        <section className="space-y-4" aria-label="Review">
          <p className="text-sm" data-testid="uat-import-staged-count">
            <strong>{stagedCount}</strong> row{stagedCount === 1 ? '' : 's'} staged and saved.
            Nothing has been created yet.
          </p>

          {archiveWarning && (
            <p className="text-xs text-amber-700 flex items-start gap-1.5" role="status">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
              The rows are saved, but a copy of <strong>{file?.name}</strong> could not be kept
              with the batch ({archiveWarning}). The import can go ahead — keep your own copy of
              the file in case a row needs checking later.
            </p>
          )}

          {preview && (
            <>
              <p className="text-sm">
                <strong>{preview.valid.length}</strong> will be created;{' '}
                <strong>{preview.invalid.length}</strong> cannot be.
              </p>
              {preview.invalid.length > 0 && (
                <div className="rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 w-24">Row</th>
                        <th className="text-left px-3 py-2">Why it cannot be created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.invalid.slice(0, 100).map((bad) => (
                        <tr key={bad.sourceRow} className="border-t border-border">
                          <td className="px-3 py-1.5 tabular-nums">{bad.sourceRow}</td>
                          <td className="px-3 py-1.5">
                            {bad.reasons.map((r) => r.reason).join(' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.invalid.length > 100 && (
                    <p className="text-xs text-muted-foreground px-3 py-2">
                      Showing the first 100 of {preview.invalid.length}. Every one is listed on the
                      batch page after you create.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {progress && commit.isPending && (
            <p className="text-sm text-muted-foreground flex items-center gap-2" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress.done} of {progress.total} — {progress.created} created,{' '}
              {progress.skipped} skipped, {progress.failed} failed
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep('map')} disabled={commit.isPending}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Change the mapping
            </Button>
            <Button
              onClick={() => void handleCommit()}
              disabled={commit.isPending || (preview?.valid.length ?? 0) === 0}
            >
              {commit.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                : <ArrowRight className="mr-1.5 h-4 w-4" aria-hidden />}
              Create {preview?.valid.length ?? 0} test case
              {(preview?.valid.length ?? 0) === 1 ? '' : 's'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Changing the mapping re-stages the file as a new batch. This one stays, and you can
            open it from the project's imports at any time.
          </p>
        </section>
      )}

      {/* ── Step 4: done ─────────────────────────────────────────────────── */}
      {step === 'done' && (
        <section className="space-y-3" aria-label="Finished">
          <p className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
            {progress?.created ?? 0} test case{(progress?.created ?? 0) === 1 ? '' : 's'} created
            {(progress?.failed ?? 0) > 0 && `, ${progress?.failed} row(s) failed`}
            {(progress?.skipped ?? 0) > 0 && `, ${progress?.skipped} already existed`}.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate(`/uat/imports/${batchId}`)}>
              Open the batch
            </Button>
            <Button variant="outline" onClick={() => navigate(`/projects/${projectId}?tab=uat`)}>
              Back to the project
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The sidebar route arrives with no project, and a test case cannot exist without one.
 *
 * A picker rather than an error: "open this from a project's UAT tab" is a dead end dressed
 * as guidance, and the operator is already on the page they wanted. Selecting a project
 * puts it in the URL, so the choice survives a reload and can be linked to.
 */
function ChooseProject() {
  const [, setParams] = useSearchParams();
  const { data: projects = [], isPending, isError, refetch } = useActiveProjects();

  return (
    <div className="p-6 space-y-4 max-w-xl">
      <div>
        <h1 className="text-xl font-semibold">Import test cases</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which project are these test cases for? Imported cases belong to one project, and it
          cannot be changed afterwards.
        </p>
      </div>
      {isPending && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading projects…
        </p>
      )}
      {isError && (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">The project list could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
        </div>
      )}
      {!isPending && !isError && (
        <div className="space-y-1.5">
          <Label htmlFor="uat-import-project">Project</Label>
          <select
            id="uat-import-project"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) setParams({ projectId: e.target.value });
            }}
          >
            <option value="" disabled>Choose a project…</option>
            {projects.map((project) => (
              <option key={project.msdyn_projectid} value={project.msdyn_projectid}>
                {project.msdyn_subject}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export default ImportWizardPage;
