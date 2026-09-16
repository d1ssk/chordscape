import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
const script = resolve('scripts/pages-base.mjs');
it('derives project/root bases and honors explicit overrides and CNAME', () => {
  for (const [repo, override, cname, expected] of [
    ['user/project', '', '', '/project/'],
    ['User/user.github.io', '', '', '/'],
    ['user/other.github.io', '', '', '/other.github.io/'],
    ['user/project', '/custom/', '', '/custom/'],
    ['user/project', '', 'example.com', '/'],
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'chordscape-pages-'));
    try {
      const envFile = join(dir, 'environment');
      if (cname) {
        mkdirSync(join(dir, 'public'));
        writeFileSync(join(dir, 'public/CNAME'), cname);
      }
      execFileSync(process.execPath, [script], {
        cwd: dir,
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repo,
          PAGES_BASE_PATH: override,
          GITHUB_ENV: envFile,
        },
      });
      expect(readFileSync(envFile, 'utf8')).toBe(
        `VITE_BASE_PATH=${expected}\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
