function unsupported(functionName: string): never {
	throw new Error(
		`node:zlib ${functionName} is not available in this Obsidian browser bundle.`,
	)
}

export const constants = {
	Z_BEST_COMPRESSION: 9,
	Z_BEST_SPEED: 1,
	Z_DEFAULT_COMPRESSION: -1,
}

export function gunzipSync(): never {
	return unsupported('gunzipSync')
}

export function gzipSync(): never {
	return unsupported('gzipSync')
}

export function deflateSync(): never {
	return unsupported('deflateSync')
}

export function inflateSync(): never {
	return unsupported('inflateSync')
}
