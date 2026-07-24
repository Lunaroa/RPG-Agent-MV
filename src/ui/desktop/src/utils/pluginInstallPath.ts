/** Derive plugins.js name from an absolute/relative source path. */
export function derivePluginInstallNameFromSourcePath(sourceFile: string): string {
  const normalized = String(sourceFile || '').trim().replace(/\\/g, '/');
  const match = /\/(?:www\/)?js\/plugins\/(.+)\.js$/i.exec(normalized);
  if (match?.[1]) {
    const nested = match[1].replace(/^\/+|\/+$/g, '');
    const parts = nested.split('/');
    if (nested && !parts.some((part) => !part || part === '.' || part === '..')) {
      return nested;
    }
  }
  const base = normalized.split('/').pop() || '';
  return base.replace(/\.js$/i, '');
}
