import { existsSync, appendFileSync } from 'node:fs';
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
if (!repo) throw new Error('GITHUB_REPOSITORY is required');
const base =
  process.env.PAGES_BASE_PATH ||
  (existsSync('public/CNAME') || repo.endsWith('.github.io')
    ? '/'
    : `/${repo}/`);
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base))
  throw new Error('Base must start and end with /');
appendFileSync(process.env.GITHUB_ENV, `VITE_BASE_PATH=${base}\n`);
