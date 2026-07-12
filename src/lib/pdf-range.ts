// Page-range grammar: comma-separated terms `N`, `N-M`, `N-` (open end), `-M`
// (from page 1). 1-based, whitespace-tolerant.

const TERM = /^(?:(\d+)\s*-\s*(\d+)?|-\s*(\d+)|(\d+))$/;

const HINT = 'Enter pages, e.g. 1-3,7,12-';

/** Syntax-only check for live UI validation; null = valid. */
export function validatePageRangeSyntax(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return HINT;
	for (const raw of trimmed.split(',')) {
		const term = raw.trim();
		if (!term || !TERM.test(term)) return `Invalid range "${raw.trim() || ','}" — ${HINT}`;
	}
	return null;
}

/** Resolves to a sorted, unique, 1-based page list; throws with a precise message. */
export function resolvePageRange(input: string, pageCount: number): number[] {
	const syntaxError = validatePageRangeSyntax(input);
	if (syntaxError) throw new Error(syntaxError);

	const pages = new Set<number>();
	for (const raw of input.trim().split(',')) {
		const match = TERM.exec(raw.trim());
		if (!match) continue;
		let from: number;
		let to: number;
		if (match[4] !== undefined) {
			from = to = Number(match[4]);
		} else if (match[3] !== undefined) {
			from = 1;
			to = Number(match[3]);
		} else {
			from = Number(match[1]);
			to = match[2] !== undefined ? Number(match[2]) : pageCount;
		}
		if (from < 1 || to > pageCount) {
			throw new Error(
				`page ${to > pageCount ? to : from} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'})`
			);
		}
		if (from > to) throw new Error(`range ${from}-${to} is reversed`);
		for (let p = from; p <= to; p++) pages.add(p);
	}
	return [...pages].sort((a, b) => a - b);
}

export function complementPages(pages: number[], pageCount: number): number[] {
	const remove = new Set(pages);
	const keep: number[] = [];
	for (let p = 1; p <= pageCount; p++) if (!remove.has(p)) keep.push(p);
	return keep;
}
