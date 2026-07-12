/**
 * Pins the app.html theme-init script to the hash allow-listed in kit.csp's
 * script-src (svelte.config.js). Kit hashes only its own hydration script —
 * the theme script's hash is maintained by hand, and any edit (even a
 * Prettier reformat) would silently break dev and runtime-rendered 404 pages,
 * where the CSP arrives as a header covering the whole document. This test
 * turns that drift into a hard failure with the correct value in the message.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import config from '../../svelte.config.js';

it('the CSP script-src hash matches the app.html theme script', () => {
	const html = readFileSync('src/app.html', 'utf8');
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
	expect(scripts, 'app.html must have exactly one hashable inline script').toHaveLength(1);
	const digest = createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');

	const scriptSrc = config.kit?.csp?.directives?.['script-src'] ?? [];
	const hashes = scriptSrc.filter((source) => source.startsWith('sha256-'));
	expect(hashes, 'update svelte.config.js script-src when the theme script changes').toEqual([
		`sha256-${digest}`
	]);
});
