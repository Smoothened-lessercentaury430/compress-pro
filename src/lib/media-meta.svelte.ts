/**
 * Duration/dimensions metadata for uploaded video & audio files — probed once
 * per file so the settings panel can show a live output-size estimate. The
 * cache is a SvelteMap: estimate deriveds re-run when a probe lands.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { UploadedFile } from '$lib/types';

export interface MediaMeta {
	durationSec: number;
	/** 0×0 for pure-audio files — the duration is all the estimate needs. */
	width: number;
	height: number;
}

/** null = probe failed (undecodable container, e.g. MKV) → no estimate. */
const metas = new SvelteMap<string, MediaMeta | null>();

/** Reactive lookup; undefined = not probed (yet). */
export function mediaMeta(id: string): MediaMeta | null | undefined {
	return metas.get(id);
}

/**
 * Fire-and-forget metadata probe via a detached <video> — it demuxes audio
 * files too, and metadata parsing works even where DECODING doesn't (HEVC).
 */
export function probeMedia(file: UploadedFile): void {
	if (metas.has(file.id)) return;
	const el = document.createElement('video');
	el.preload = 'metadata';
	const done = (meta: MediaMeta | null) => {
		// A late probe after removeMeta re-adds a dead id — ids are never
		// reused, so the stray entry is inert.
		metas.set(file.id, meta);
		el.removeAttribute('src'); // release the element's hold on the blob
		el.load();
	};
	const timer = setTimeout(() => done(null), 10_000);
	el.onloadedmetadata = () => {
		clearTimeout(timer);
		done(
			Number.isFinite(el.duration) && el.duration > 0
				? { durationSec: el.duration, width: el.videoWidth, height: el.videoHeight }
				: null
		);
	};
	el.onerror = () => {
		clearTimeout(timer);
		done(null);
	};
	el.src = file.objectUrl;
}

export function removeMeta(id: string): void {
	metas.delete(id);
}
