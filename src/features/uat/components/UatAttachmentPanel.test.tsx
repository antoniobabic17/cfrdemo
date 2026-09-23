/**
 * T031 — the attachment panel: no count cap, one paste means one row, one message.
 *
 * The three acceptance clauses map onto three claims that could each be true in the code
 * and false in the product, so each is driven through the real component:
 *
 *  1. **Six files attach.** The legacy ceiling was five fixed image columns. Six is the
 *     number that proves the ceiling is gone, so six is what the test attaches, and it
 *     asserts six uploads — not "no constant found".
 *  2. **One paste, one attachment.** A ClipboardEvent dispatches to every listener, so
 *     two mounted panels are the realistic way to get two rows from one Ctrl+V. Both
 *     panels are mounted and the count is asserted at one.
 *  3. **The same message from all three entry points.** Asserted by comparing the actual
 *     toast text from a drag, a browse and a paste of the same oversized file — not by
 *     reading the source for one shared function.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('../../../hooks/useToast', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a), warning: vi.fn(), info: vi.fn() },
}));

const attachAsync = vi.fn();
const detachMutate = vi.fn();
const evidenceState = {
  items: [] as unknown[],
  truncated: false,
  isPending: false,
  isError: false,
  error: null as unknown,
  linksUnavailable: false,
};
vi.mock('../../../hooks/useUatAttachments', () => ({
  useUatEvidence: () => evidenceState,
  useAttachUatEvidence: () => ({ mutateAsync: attachAsync, isPending: false }),
  useDetachUatEvidence: () => ({ mutate: detachMutate, isPending: false }),
}));

import { UatAttachmentPanel, imageFilesFromClipboard } from './UatAttachmentPanel';
import { UAT_ATTACHMENT_CATEGORY } from '../../../lib/uatOptionSets';
import { UAT_MAX_FILE_BYTES } from '../lib/uatEvidence';

const png = (name: string, size = 8) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

const oversized = (name = 'huge.png'): File =>
  Object.defineProperty(png(name), 'size', { value: UAT_MAX_FILE_BYTES + 1 });

/** A DataTransfer stand-in — jsdom has no constructor for one. */
function clipboard(items: { kind: string; type: string; file?: File }[]): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
    files: items.map((i) => i.file).filter(Boolean) as File[],
  } as unknown as DataTransfer;
}

function pasteOnWindow(data: DataTransfer) {
  const event = new Event('paste', { bubbles: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: data });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  attachAsync.mockResolvedValue({});
  evidenceState.items = [];
  evidenceState.truncated = false;
  evidenceState.isPending = false;
  evidenceState.isError = false;
  evidenceState.linksUnavailable = false;
});

describe('the five-file ceiling is gone', () => {
  it('attaches six files picked in one go', async () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    const input = screen.getByTestId('uat-evidence-file-input');
    const files = [1, 2, 3, 4, 5, 6].map((n) => png(`shot-${n}.png`));
    fireEvent.change(input, { target: { files } });

    await waitFor(() => expect(attachAsync).toHaveBeenCalledTimes(6));
    expect(attachAsync.mock.calls.map((c) => (c[0] as { file: File }).file.name))
      .toEqual(['shot-1.png', 'shot-2.png', 'shot-3.png', 'shot-4.png', 'shot-5.png', 'shot-6.png']);
    expect(toastSuccess).toHaveBeenCalledWith('6 files attached.');
  });

  it('uploads them one at a time rather than all at once', async () => {
    // Each upload base64-encodes its whole body in the browser. Six in flight is how a
    // tab dies on a set of screenshots, so the ordering here is a real constraint.
    let inFlight = 0;
    let peak = 0;
    attachAsync.mockImplementation(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
    });
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    fireEvent.change(screen.getByTestId('uat-evidence-file-input'), {
      target: { files: [png('a.png'), png('b.png'), png('c.png')] },
    });
    await waitFor(() => expect(attachAsync).toHaveBeenCalledTimes(3));
    expect(peak).toBe(1);
  });

  it('attaches the good files when one in the batch is rejected', async () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    fireEvent.change(screen.getByTestId('uat-evidence-file-input'), {
      target: { files: [png('ok-1.png'), oversized(), png('ok-2.png')] },
    });
    await waitFor(() => expect(attachAsync).toHaveBeenCalledTimes(2));
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe('paste capture', () => {
  it('produces exactly one screenshot attachment from one paste, with two panels mounted', async () => {
    render(
      <>
        <UatAttachmentPanel parent="TestCase" parentId="tc-1" />
        <UatAttachmentPanel parent="TestRun" parentId="tr-1" heading="Run evidence" />
      </>,
    );
    pasteOnWindow(clipboard([{ kind: 'file', type: 'image/png', file: png('image.png') }]));

    await waitFor(() => expect(attachAsync).toHaveBeenCalledTimes(1));
    const vars = attachAsync.mock.calls[0][0] as { file: File; category: number };
    expect(vars.category).toBe(UAT_ATTACHMENT_CATEGORY.Screenshot);
    // Chromium's invented 'image.png' is replaced so two pastes don't collide.
    expect(vars.file.name).toMatch(/^screenshot-.*\.png$/);
  });

  it('ignores a plain text paste', async () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    pasteOnWindow(clipboard([{ kind: 'string', type: 'text/plain' }]));
    await Promise.resolve();
    expect(attachAsync).not.toHaveBeenCalled();
  });

  it('keeps a real file\'s own name when one is pasted from the file manager', () => {
    const files = imageFilesFromClipboard(clipboard([
      { kind: 'file', type: 'image/png', file: png('defect-evidence.png') },
    ]));
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('defect-evidence.png');
  });

  it('passes the pasted bytes through untouched — the file object itself is forwarded', async () => {
    // FR-031b is about bytes surviving. The panel must not stringify, re-encode or
    // re-wrap in a way that loses them; the size and type reaching the upload are the
    // observable part of that here, and the byte-level proof is the DEV probe.
    // A byte pattern with high bytes in it — the class of content the disqualified
    // connector route turned into mojibake. Anything below 0x80 would round-trip either way.
    const real = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xfe, 0x80]);
    const file = new File([real], 'image.png', { type: 'image/png' });
    render(<UatAttachmentPanel parent="Defect" parentId="d-1" />);
    pasteOnWindow(clipboard([{ kind: 'file', type: 'image/png', file }]));
    await waitFor(() => expect(attachAsync).toHaveBeenCalledTimes(1));
    const sent = (attachAsync.mock.calls[0][0] as { file: File }).file;
    expect(sent.size).toBe(real.byteLength);
    expect(new Uint8Array(await sent.arrayBuffer())).toEqual(real);
  });
});

describe('one rejection message, whatever the entry point (FR-035)', () => {
  it('says byte-identical things for a drag, a browse and a paste of the same file', async () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);

    fireEvent.change(screen.getByTestId('uat-evidence-file-input'), { target: { files: [oversized()] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    const browsed = toastError.mock.calls[0][0];

    fireEvent.drop(screen.getByTestId('uat-evidence-dropzone'), {
      dataTransfer: { files: [oversized()] },
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
    const dragged = toastError.mock.calls[1][0];

    pasteOnWindow(clipboard([{ kind: 'file', type: 'image/png', file: oversized() }]));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(3));
    const pasted = toastError.mock.calls[2][0];

    expect(dragged).toBe(browsed);
    expect(pasted).toBe(browsed);
    expect(browsed).toContain('The limit is');
    expect(attachAsync).not.toHaveBeenCalled();   // rejected BEFORE upload
  });
});

describe('the panel never captures the screen itself', () => {
  const source = Object.values(
    import.meta.glob('./UatAttachmentPanel.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  )[0];

  /**
   * Comments stripped before scanning. The component's own header names these APIs to
   * say it does not use them, and a guard that cannot tell a prohibition from a call is
   * a guard that has to be worked around — which is how it ends up deleted.
   */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  it('references no capture or recording API', () => {
    // The tester captures with the OS and the app receives. A convenience button here is
    // how that boundary would erode, so the absence is asserted rather than intended.
    for (const api of ['getDisplayMedia', 'MediaRecorder', 'mediaDevices', 'getUserMedia', 'captureStream']) {
      expect(code).not.toContain(api);
    }
  });

  it('offers no recording control in its UI', () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    expect(screen.queryByText(/record/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /capture/i })).toBeNull();
  });
});

describe('states', () => {
  it('refuses to offer attachment before the parent record exists', () => {
    render(<UatAttachmentPanel parent="TestCase" parentId={undefined} />);
    expect(screen.getByText(/Save this record before attaching/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Attach/i })).toBeDisabled();
  });

  it('distinguishes "nothing attached" from "could not load"', () => {
    const { unmount } = render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    expect(screen.getByText(/No evidence attached yet/i)).toBeTruthy();
    unmount();

    evidenceState.isError = true;
    evidenceState.error = new Error('403');
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    // A failed load claiming "no evidence" would tell the tester their evidence is gone.
    expect(screen.queryByText(/No evidence attached yet/i)).toBeNull();
    expect(screen.getByRole('alert').textContent).toMatch(/may still be attached/i);
  });

  it('says so when the library read could not be paged to the end', () => {
    evidenceState.truncated = true;
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    expect(screen.getByRole('status').textContent).toMatch(/more files than could be listed/i);
  });

  it('disables open — rather than hiding the file — when no link resolved', () => {
    evidenceState.items = [{
      row: { pmo_uatattachmentid: 'a-1', pmo_filename: 'shot.png', pmo_filesizebytes: 2048, pmo_category: UAT_ATTACHMENT_CATEGORY.Screenshot },
      itemId: '', link: undefined,
    }];
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" />);
    expect(screen.getByText('shot.png')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open shot.png' })).toBeDisabled();
  });

  it('hides every write control in read-only mode but still lists the evidence', () => {
    evidenceState.items = [{
      row: { pmo_uatattachmentid: 'a-1', pmo_filename: 'shot.png', pmo_category: UAT_ATTACHMENT_CATEGORY.Screenshot },
      itemId: '9', link: 'https://sp/shot.png',
    }];
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" readOnly />);
    expect(screen.getByText('shot.png')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Attach/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove shot.png/i })).toBeNull();
    expect(screen.queryByTestId('uat-evidence-dropzone')).toBeNull();
  });

  it('does not attach a paste while read-only', async () => {
    render(<UatAttachmentPanel parent="TestCase" parentId="tc-1" readOnly />);
    pasteOnWindow(clipboard([{ kind: 'file', type: 'image/png', file: png('image.png') }]));
    await Promise.resolve();
    expect(attachAsync).not.toHaveBeenCalled();
  });
});
