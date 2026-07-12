import { optimize } from 'svgo/browser';
import type { Config } from 'svgo/browser';
import type { SvgCompressionSettings } from '$lib/types';
import type { WorkerContracts } from './protocol';
import { expose } from './host';

function compressSvg(svgString: string, settings: SvgCompressionSettings): string {
	const precision = settings.precision ?? 3;

	const config: Config = {
		multipass: true,
		floatPrecision: precision,
		plugins: [
			{
				name: 'preset-default',
				params: {
					overrides: {
						removeComments: settings.removeComments,
						removeMetadata: settings.removeMetadata,
						cleanupIds: settings.cleanupIds,
						cleanupNumericValues: { floatPrecision: precision },
						convertPathData: { floatPrecision: precision },
						convertTransform: { floatPrecision: precision }
					}
				}
			} as never,
			...(settings.removeDimensions ? ['removeDimensions' as const] : []),
			// Opt-in extra lossless-for-static-SVGs passes. Deliberately excluded:
			// removeRasterImages/removeStyleElement/removeXMLNS/removeTitle (break
			// rendering, standalone files, or accessibility).
			...(settings.aggressive
				? ([
						{ name: 'cleanupListOfValues', params: { floatPrecision: precision } },
						'convertStyleToAttrs',
						'convertOneStopGradients',
						'removeOffCanvasPaths',
						'reusePaths'
					] as never[])
				: [])
		]
	};

	return optimize(svgString, config).data;
}

expose<WorkerContracts['svg']>({
	optimize: async ({ svg, settings }) => ({
		result: compressSvg(svg, settings)
	})
});
