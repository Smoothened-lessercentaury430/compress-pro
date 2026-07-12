import type { ParamMatcher } from '@sveltejs/kit';
import { TOOL_SLUGS } from '$lib/seo';

// Single source of truth: any path listed in seo.ts (formats + converters + tools)
// is a page, everything else falls through to the 404 page.
export const match = ((param) => TOOL_SLUGS.includes(param)) satisfies ParamMatcher;
