import { describe, expect, it } from 'vitest';
import { parseSvgSize, prepareSvgForRaster } from './svg-raster';

describe('parseSvgSize', () => {
	it('reads absolute width/height attributes, with or without px', () => {
		expect(parseSvgSize('<svg width="800" height="600"></svg>')).toEqual({
			width: 800,
			height: 600
		});
		expect(parseSvgSize('<svg width="800px" height="600px"></svg>')).toEqual({
			width: 800,
			height: 600
		});
	});

	it('accepts single-quoted attributes', () => {
		expect(parseSvgSize("<svg width='320' height='240'></svg>")).toEqual({
			width: 320,
			height: 240
		});
	});

	it('falls back to viewBox extents (comma or space separated)', () => {
		expect(parseSvgSize('<svg viewBox="0 0 24 24"></svg>')).toEqual({ width: 24, height: 24 });
		expect(parseSvgSize('<svg viewBox="0,0,120,80"></svg>')).toEqual({ width: 120, height: 80 });
	});

	it('ignores percentage sizes and uses the viewBox instead', () => {
		expect(parseSvgSize('<svg width="100%" height="100%" viewBox="0 0 64 32"></svg>')).toEqual({
			width: 64,
			height: 32
		});
	});

	it('returns null without any size information or without an <svg> root', () => {
		expect(parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBeNull();
		expect(parseSvgSize('not an svg at all')).toBeNull();
		expect(parseSvgSize('<svg viewBox="0 0 0 0"></svg>')).toBeNull();
	});
});

describe('prepareSvgForRaster', () => {
	it('replaces width/height with the render size', () => {
		const out = prepareSvgForRaster(
			'<svg width="24" height="24" viewBox="0 0 24 24"><g/></svg>',
			512,
			512
		);
		expect(out).toContain('width="512"');
		expect(out).toContain('height="512"');
		expect(out).toContain('viewBox="0 0 24 24"'); // content still scales from the box
		expect(out.match(/width=/g)).toHaveLength(1);
	});

	it('injects a viewBox from the original size when only width/height exist', () => {
		const out = prepareSvgForRaster('<svg width="100" height="50"><rect/></svg>', 1024, 512);
		expect(out).toContain('viewBox="0 0 100 50"');
		expect(out).toContain('width="1024"');
		expect(out).toContain('height="512"');
	});

	it('sets the size without a viewBox when the source has no size info', () => {
		const out = prepareSvgForRaster('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', 256, 256);
		expect(out).toContain('width="256"');
		expect(out).not.toContain('viewBox');
	});

	it('leaves non-SVG text untouched', () => {
		expect(prepareSvgForRaster('plain text', 100, 100)).toBe('plain text');
	});
});
