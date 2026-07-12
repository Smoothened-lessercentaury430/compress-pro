import type { WorkerRequest, WorkerResponse } from './protocol';

type Methods = Record<string, { payload: unknown; result: unknown; progress: unknown }>;

export type Handlers<C extends Methods> = {
	[A in keyof C]: (
		payload: C[A]['payload'],
		progress: (p: C[A]['progress']) => void
	) => Promise<{ result: C[A]['result']; transfer?: Transferable[] }>;
};

/**
 * Worker-side runtime: wires handlers to the request/response protocol.
 * Instantiate with the worker's contract, e.g. `expose<WorkerContracts['image']>({...})`.
 */
export function expose<C extends Methods>(handlers: Handlers<C>): void {
	const scope = self as unknown as Worker;
	// The wire carries untyped payloads; this is the single cast at the
	// runtime dispatch boundary — handler authors see contract types only.
	const table = handlers as Record<
		string,
		(
			payload: unknown,
			progress: (p: unknown) => void
		) => Promise<{ result: unknown; transfer?: Transferable[] }>
	>;

	scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
		const { id, action, payload } = event.data;
		const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
			scope.postMessage(message, transfer);

		try {
			const handler = table[action];
			if (!handler) throw new Error(`Unknown worker action: ${action}`);
			const { result, transfer } = await handler(payload, (p) => post({ id, progress: p }));
			post({ id, ok: true, result }, transfer ?? []);
		} catch (error) {
			post({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	};
}
