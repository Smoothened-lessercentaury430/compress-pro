import type { Handle } from '@sveltejs/kit';

/**
 * Cross-origin isolation (SharedArrayBuffer → threaded AVIF/oxipng wasm) plus
 * the security-header set. Production pages are prerendered and get all of
 * these from the root _headers file; this hook covers the dev server (Vite's
 * server.headers don't reach Kit's SSR middleware) and the runtime routes
 * (robots.txt, sitemap.xml, llms.txt, 404s). The Content-Security-Policy for
 * runtime-rendered pages is added by kit.csp itself — never set it here.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=()'
	);
	return response;
};
