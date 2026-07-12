/**
 * Codec-flag benchmark harness over the e2e suite's per-case manifests.
 *
 *   node scripts/benchmark.mjs --save <label>     # snapshot test-results/manifest/*.json
 *   node scripts/benchmark.mjs --compare <label>  # current manifests vs snapshot (markdown table)
 *
 * Workflow: run the suite (or a grep subset), --save baseline, change ONE
 * codec flag, re-run the same subset, --compare baseline. A flag stays only
 * if mean size delta ≤ −1.5% on affected cases, no diffRatio leaves its
 * budget, and durations stay < 2.5×.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_DIR = join(ROOT, 'test-results', 'manifest');
const BENCH_DIR = join(ROOT, 'test-results', 'bench');

/** caseId → {bytes, diffRatio, durationMs} from the current manifests. */
function snapshot() {
	const out = {};
	if (!existsSync(MANIFEST_DIR)) return out;
	for (const f of readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json'))) {
		const t = JSON.parse(readFileSync(join(MANIFEST_DIR, f), 'utf8'));
		for (const c of t.cases) {
			if (!c.output?.bytes) continue;
			out[c.id] = {
				bytes: c.output.bytes,
				diffRatio: c.metrics?.diffRatio ?? null,
				durationMs: t.durationMs
			};
		}
	}
	return out;
}

const fmt = (n) =>
	n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + ' MB' : (n / 1000).toFixed(1) + ' kB';

const mode = process.argv[2];
const label = process.argv[3];
if (!['--save', '--compare'].includes(mode) || !label) {
	console.error('usage: node scripts/benchmark.mjs --save <label> | --compare <label>');
	process.exit(1);
}

if (mode === '--save') {
	const snap = snapshot();
	if (Object.keys(snap).length === 0) {
		console.error('no manifests found — run the e2e suite first');
		process.exit(1);
	}
	mkdirSync(BENCH_DIR, { recursive: true });
	writeFileSync(join(BENCH_DIR, `${label}.json`), JSON.stringify(snap, null, '\t'));
	console.log(`saved ${Object.keys(snap).length} cases → test-results/bench/${label}.json`);
} else {
	const basePath = join(BENCH_DIR, `${label}.json`);
	if (!existsSync(basePath)) {
		console.error(`no snapshot at ${basePath} — run --save first`);
		process.exit(1);
	}
	const base = JSON.parse(readFileSync(basePath, 'utf8'));
	const now = snapshot();
	const ids = Object.keys(base).filter((id) => now[id]);
	if (ids.length === 0) {
		console.error('no overlapping cases between snapshot and current manifests');
		process.exit(1);
	}

	let sumDelta = 0;
	let changed = 0;
	const rows = [];
	for (const id of ids.sort()) {
		const b = base[id];
		const n = now[id];
		const delta = ((n.bytes - b.bytes) / b.bytes) * 100;
		if (Math.abs(delta) >= 0.05) changed++;
		sumDelta += delta;
		const diffB = b.diffRatio == null ? '—' : b.diffRatio.toFixed(4);
		const diffN = n.diffRatio == null ? '—' : n.diffRatio.toFixed(4);
		const timeX = b.durationMs > 0 ? (n.durationMs / b.durationMs).toFixed(2) + '×' : '—';
		rows.push(
			`| ${id} | ${fmt(b.bytes)} | ${fmt(n.bytes)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% | ${diffB} → ${diffN} | ${timeX} |`
		);
	}
	console.log(`\n## benchmark vs "${label}" (${ids.length} cases, ${changed} changed)\n`);
	console.log('| case | bytes before | bytes after | Δ | diffRatio | time |');
	console.log('|---|---|---|---|---|---|');
	for (const r of rows) console.log(r);
	console.log(`\nmean size delta: ${(sumDelta / ids.length).toFixed(2)}%`);
	// Sanity flags for the keep/revert decision:
	const worse = ids.filter(
		(id) =>
			now[id].diffRatio != null &&
			base[id].diffRatio != null &&
			now[id].diffRatio > base[id].diffRatio * 1.5 &&
			now[id].diffRatio > 0.005
	);
	if (worse.length) console.log(`⚠ diffRatio grew >1.5× on: ${worse.join(', ')}`);
	const slow = ids.filter(
		(id) => base[id].durationMs > 0 && now[id].durationMs / base[id].durationMs > 2.5
	);
	if (slow.length) console.log(`⚠ duration >2.5× on: ${slow.join(', ')}`);
}
