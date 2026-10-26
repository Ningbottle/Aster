import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { insideRoot, resolveFileInRoot } from '../../src/main/native-paths';

let base = '';
let root = '';
let outside = '';

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'aster-native-paths-'));
  root = join(base, 'workspace');
  outside = join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, 'note.txt'), 'inside');
  await writeFile(join(root, '..notes.txt'), 'dot-prefixed sibling name');
  await writeFile(join(outside, 'secret.txt'), 'outside');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('workspace file boundary', () => {
  it('resolves relative and absolute paths inside the real root', async () => {
    const realRoot = await realpath(root);
    await expect(resolveFileInRoot(root, 'note.txt')).resolves.toBe(join(realRoot, 'note.txt'));
    await expect(resolveFileInRoot(root, join(root, 'note.txt'))).resolves.toBe(join(realRoot, 'note.txt'));
  });

  it('keeps dot-prefixed names inside while rejecting parent traversal', async () => {
    await expect(resolveFileInRoot(root, '..notes.txt')).resolves.toContain('..notes.txt');
    await expect(resolveFileInRoot(root, '../outside/secret.txt')).rejects.toThrow('outside the project folder');
  });

  it('rejects absolute paths outside the root and sibling prefixes', async () => {
    await expect(resolveFileInRoot(root, join(outside, 'secret.txt'))).rejects.toThrow('outside the project folder');
    expect(insideRoot(root, `${root}-sibling/note.txt`)).toBe(false);
    expect(insideRoot(root, root)).toBe(true);
  });

  it('rejects a file reached through a junction that leaves the root', async () => {
    try {
      await symlink(outside, join(root, 'escape'), 'junction');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw error;
    }
    await expect(resolveFileInRoot(root, 'escape/secret.txt')).rejects.toThrow('outside the project folder');
  });

  it('reports a missing file instead of opening it', async () => {
    await expect(resolveFileInRoot(root, 'missing.txt')).rejects.toThrow('The file does not exist.');
  });

  it('compares case-insensitively on Windows only', () => {
    if (process.platform !== 'win32') return;
    expect(insideRoot(resolve(root), resolve(root).toLocaleUpperCase('en-US'))).toBe(true);
  });
});
