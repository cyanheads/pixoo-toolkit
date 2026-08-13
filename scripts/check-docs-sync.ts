/** scripts/check-docs-sync.ts — Keep agent protocol files byte-identical. */

import { readFile } from 'node:fs/promises';

const [claude, agents] = await Promise.all([
  readFile(new URL('../CLAUDE.md', import.meta.url), 'utf8'),
  readFile(new URL('../AGENTS.md', import.meta.url), 'utf8'),
]);

if (claude !== agents) {
  throw new Error('CLAUDE.md and AGENTS.md differ; update CLAUDE.md, then copy it to AGENTS.md');
}
