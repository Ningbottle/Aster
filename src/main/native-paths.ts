import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const fold = (value: string): string => (process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value);

/** True when target is the root itself or one of its descendants; sibling-prefix paths do not count. */
export function insideRoot(root: string, target: string): boolean {
  const rel = relative(fold(root), fold(target));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/**
 * Resolves the real path of a requested file and proves it stays inside the real workspace root.
 * Real paths stop junctions, symlinks, and drive-relative spellings from escaping the boundary.
 */
export async function resolveFileInRoot(root: string, requested: string): Promise<string> {
  const realRoot = await realpath(root);
  let realTarget: string;
  try {
    realTarget = await realpath(resolve(realRoot, requested));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') throw new Error('The file does not exist.');
    throw error;
  }
  if (!insideRoot(realRoot, realTarget)) throw new Error('The file is outside the project folder.');
  return realTarget;
}
