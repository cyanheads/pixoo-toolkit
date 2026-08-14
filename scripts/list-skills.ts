/**
 * scripts/list-skills.ts — Print an index of this project's skills.
 *
 * A sub-agent does not inherit the parent session's skill registry, so it
 * cannot see the SKILL.md files sitting in its own working directory. Running
 * this gives it the name, description, and absolute path of each one to read.
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));

/** Pull `name` and `description` out of SKILL.md frontmatter, including folded (`>`) blocks. */
function parseFrontmatter(content: string): Record<string, string> {
  const body = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
  if (!body) return {};

  const fields: Record<string, string> = {};
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const pair = /^(\w+):\s*(.*)$/.exec(lines[i]!);
    if (!pair) continue;
    const [, key, rawValue] = pair as unknown as [string, string, string];

    if (rawValue.trim() === '>' || rawValue.trim() === '|') {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) folded.push(lines[++i]!.trim());
      fields[key] = folded.join(rawValue.trim() === '|' ? '\n' : ' ');
      continue;
    }
    fields[key] = rawValue.trim().replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

const entries = await readdir(skillsDir, { withFileTypes: true });
const skills = await Promise.all(
  entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const path = `${skillsDir}/${entry.name}/SKILL.md`;
      const frontmatter = parseFrontmatter(await readFile(path, 'utf8'));
      return {
        name: frontmatter.name ?? entry.name,
        description: frontmatter.description ?? '',
        path,
      };
    }),
);

skills.sort((a, b) => a.name.localeCompare(b.name));

console.log(`# Skills in ${skillsDir}`);
console.log('# Read the full SKILL.md at the listed path before following its procedure.\n');
for (const skill of skills) {
  console.log(`- ${skill.name} (${skill.path})`);
  if (skill.description) console.log(`  ${skill.description}`);
  console.log();
}
console.log(`Total: ${skills.length} skills`);
