/** Local data documents used while no authenticated Host origin is available. */

/** Navigation target reserved for the desktop retry command. */
export const DESKTOP_RETRY_URL = 'dsh-desktop:retry'

/** Escape diagnostic text before embedding it in a local HTML document. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Build one CSP-restricted data URL for the desktop status window. */
function documentUrl(title: string, body: string): string {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(title) + '</title>'
    + '<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;background:Canvas;color:CanvasText}main{width:min(420px,calc(100vw - 48px))}h1{margin:0 0 12px;font-size:24px;letter-spacing:0}p{margin:0 0 20px;line-height:1.55;color:GrayText;overflow-wrap:anywhere}a{display:inline-block;padding:9px 14px;border:1px solid ButtonBorder;border-radius:6px;background:ButtonFace;color:ButtonText;text-decoration:none}</style>'
    + '</head><body>' + body + '</body></html>'
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}

/** Return the local document displayed while the first Host starts. */
export function desktopStartingDocument(): string {
  return documentUrl('DeepSeek Harness', '<main><h1>DeepSeek Harness</h1><p>Starting Harness Host...</p></main>')
}

/**
 * Return a retryable local failure document without renderer authority.
 * @param message - escaped startup, protocol, or process diagnostic.
 * @returns a CSP-restricted data URL whose only command uses the reserved retry navigation.
 */
export function desktopFailureDocument(message: string): string {
  return documentUrl(
    'DeepSeek Harness Host stopped',
    '<main><h1>Harness Host stopped</h1><p>' + escapeHtml(message)
      + '</p><a href="' + DESKTOP_RETRY_URL + '">Retry</a></main>',
  )
}
