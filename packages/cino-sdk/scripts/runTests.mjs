import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = new URL('../test/', import.meta.url);
const files = readdirSync(dir).filter(file => file.endsWith('.test.ts')).sort();

const failed = [];
for (const file of files) {
  console.log(`\n━━ ${file}`);
  const { status } = spawnSync(process.execPath, [fileURLToPath(new URL(file, dir))], { stdio: 'inherit' });
  if (status !== 0) failed.push(file);
}

console.log(failed.length ? `\n${failed.length} file(s) failed: ${failed.join(', ')}` : `\nall ${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
