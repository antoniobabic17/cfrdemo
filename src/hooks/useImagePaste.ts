import { useEffect } from 'react';

/**
 * Capture image pastes from the system clipboard and hand each off to
 * `onImage` as a File. Generates a timestamped default filename
 * (`screenshot-YYYY-MM-DDTHH-MM-SS.png`) because clipboard blobs typically
 * arrive as `image.png` or unnamed.
 *
 * Used by feedback/bug-report forms to skip the save-to-disk → browse →
 * upload dance for screenshots. Reusable on any form that accepts images.
 *
 * @param onImage   Receives each pasted image. Stable identity recommended
 *                  (wrap in useCallback) to avoid resubscribing every render.
 * @param enabled   Default true. Set false to detach the listener
 *                  (e.g. when the form is not visible).
 */
export function useImagePaste(onImage: (file: File) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: ClipboardEvent) {
      // Skip if the paste is happening inside a contentEditable / input where
      // the editor will handle the paste itself.
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        // Rich-text editor's own paste handler will deal with text paste; but
        // we still want to catch images even there since text editors don't
        // typically embed clipboard images.
        // Only short-circuit if NO image content is in clipboard.
        const hasImage = Array.from(e.clipboardData?.items ?? []).some(
          (it) => it.kind === 'file' && it.type.startsWith('image/'),
        );
        if (!hasImage) return;
      }
      const items = e.clipboardData?.items;
      if (!items) return;
      let captured = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const ext = (blob.type.split('/')[1] ?? 'png').toLowerCase();
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const file = new File([blob], `screenshot-${ts}.${ext}`, { type: blob.type });
        captured = true;
        onImage(file);
      }
      if (captured) {
        // Stop the browser from also pasting the image as a data URL into the
        // focused contentEditable (which would render an inline base64 mess).
        e.preventDefault();
      }
    }
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [onImage, enabled]);
}
