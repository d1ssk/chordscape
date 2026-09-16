import { existsSync, appendFileSync } from 'node:fs';
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
if (!repo) throw new Error('GITHUB_REPOSITORY is required');
const base =
  process.env.PAGES_BASE_PATH ||
  (existsSync('public/CNAME') ||
  repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? '/'
    : `/${repo}/`);
if (!/^\/(?:[A-Za-z0-9._-]+\/)*$/.test(base))
  throw new Error('Base must start and end with /');
appendFileSync(process.env.GITHUB_ENV, `VITE_BASE_PATH=${base}\n`);
