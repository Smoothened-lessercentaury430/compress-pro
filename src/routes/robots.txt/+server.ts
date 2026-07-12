import { SITE_URL } from '$lib/seo';

// Served by the Worker at request time (not prerendered): non-production
// hosts (workers.dev previews, staging, localhost) must never be indexed —
// only the canonical production domain gets an Allow robots.txt.
export const prerender = false;

export function GET({ url }: { url: URL }) {
	const isProd = url.host === new URL(SITE_URL).host;
	const body = isProd
		? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
		: 'User-agent: *\nDisallow: /\n';
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
