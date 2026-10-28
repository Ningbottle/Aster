/** Display-only file name for rows and panel headers; the full path stays in a tooltip. */
export function baseName(path: string): string {
  return path.replaceAll('\\', '/').split('/').pop() || path;
}
