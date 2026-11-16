/**
 * Trigger a browser download of text content via a Blob object URL.
 * The URL is revoked immediately; the download is already initiated.
 */
export function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
