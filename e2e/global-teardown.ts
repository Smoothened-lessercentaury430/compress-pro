import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export default function globalTeardown(): void {
	const script = join(ROOT, 'scripts', 'build-report.mjs');
	if (!existsSync(script)) return;
	try {
		execFileSync('node', [script], { cwd: ROOT, stdio: 'inherit' });
	} catch (err) {
		// The report is a convenience artifact — never fail the run over it.
		console.error('build-report failed:', err);
	}
}
