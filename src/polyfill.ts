type ProcessLike = typeof globalThis.process & {
	env?: Record<string, string | undefined>
}

type RuntimeGlobal = typeof globalThis & {
	process?: ProcessLike
}

// Obsidian runs in a browser window, while unit tests run in a plain Node
// global. Resolve the host once so this module remains usable in both.
const runtimeGlobal = (
	typeof window === 'undefined' ? globalThis : window
) as RuntimeGlobal

const processLike: ProcessLike = runtimeGlobal.process ?? {
	cwd() {
		return '/'
	},
	env: {},
}

if (typeof processLike.cwd !== 'function') {
	processLike.cwd = () => '/'
}

if (!processLike.env || typeof processLike.env !== 'object') {
	processLike.env = {}
}

runtimeGlobal.process = processLike

export {}
