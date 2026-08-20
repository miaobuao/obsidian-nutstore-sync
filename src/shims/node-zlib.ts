import {
	Gunzip,
	deflateSync as fflateDeflateSync,
	gunzipSync as fflateGunzipSync,
	gzipSync as fflateGzipSync,
	inflateSync as fflateInflateSync,
} from 'fflate/browser'

export const constants = {
	Z_BEST_COMPRESSION: 9,
	Z_BEST_SPEED: 1,
	Z_DEFAULT_COMPRESSION: -1,
}

interface CompressionOptions {
	level?: number
}

interface GunzipOptions {
	maxOutputLength?: number
}

function compressionLevel(level: number | undefined) {
	if (level === undefined || level === constants.Z_DEFAULT_COMPRESSION) {
		return undefined
	}
	if (!Number.isInteger(level) || level < 0 || level > 9) {
		throw new RangeError('The "level" option must be between -1 and 9.')
	}
	return level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

function concat(chunks: Uint8Array[], length: number) {
	const output = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		output.set(chunk, offset)
		offset += chunk.length
	}
	return output
}

export function gzipSync(input: Uint8Array, options: CompressionOptions = {}) {
	return fflateGzipSync(input, { level: compressionLevel(options.level) })
}

export function gunzipSync(input: Uint8Array, options: GunzipOptions = {}) {
	if (options.maxOutputLength === undefined) {
		return fflateGunzipSync(input)
	}

	const maxOutputLength = options.maxOutputLength
	if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 0) {
		throw new RangeError(
			'The "maxOutputLength" option must be a non-negative integer.',
		)
	}

	const chunks: Uint8Array[] = []
	let outputLength = 0
	const gunzip = new Gunzip((chunk) => {
		if (outputLength + chunk.length > maxOutputLength) {
			throw new RangeError(
				`Decompressed data exceeds the maximum size of ${maxOutputLength} bytes.`,
			)
		}
		chunks.push(chunk)
		outputLength += chunk.length
	})
	gunzip.push(input, true)
	return concat(chunks, outputLength)
}

export function deflateSync(
	input: Uint8Array,
	options: CompressionOptions = {},
) {
	return fflateDeflateSync(input, { level: compressionLevel(options.level) })
}

export function inflateSync(input: Uint8Array) {
	return fflateInflateSync(input)
}
