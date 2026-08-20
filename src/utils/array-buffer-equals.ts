/**
 * Compares two binary buffers byte by byte.
 *
 * Short-circuits on `byteLength` mismatch and on the first differing word.
 * Unlike structural deep-equality helpers (e.g. lodash/ohash `isEqual`, which
 * walk object graphs or serialize every byte into a huge string), this performs
 * a single linear pass over the underlying bytes.
 *
 * Fast path: when both buffers are 4-byte aligned it compares whole 32-bit
 * words via `Uint32Array` views; otherwise it falls back to a byte-wise loop.
 * Both short-circuit on the first difference.
 */
export function arrayBufferEquals(
	left: ArrayBufferLike | Uint8Array,
	right: ArrayBufferLike | Uint8Array,
): boolean {
	if (left.byteLength !== right.byteLength) {
		return false
	}

	const lhs = toView(left)
	const rhs = toView(right)
	const length = lhs.length

	// 4-byte aligned fast path.
	if (lhs.byteOffset % 4 === 0 && rhs.byteOffset % 4 === 0) {
		const wordCount = length >> 2
		if (wordCount > 0) {
			const lhsWords = new Uint32Array(lhs.buffer, lhs.byteOffset, wordCount)
			const rhsWords = new Uint32Array(rhs.buffer, rhs.byteOffset, wordCount)
			for (let i = 0; i < wordCount; i += 1) {
				if (lhsWords[i] !== rhsWords[i]) {
					return false
				}
			}
		}
		// Compare the remaining 0-3 tail bytes.
		for (let off = wordCount << 2; off < length; off += 1) {
			if (lhs[off] !== rhs[off]) {
				return false
			}
		}
		return true
	}

	// Unaligned fallback.
	for (let i = 0; i < length; i += 1) {
		if (lhs[i] !== rhs[i]) {
			return false
		}
	}
	return true
}

/**
 * Returns a `Uint8Array` view over `value` without copying.
 *
 * Accepts `ArrayBuffer` and `Uint8Array` (incl. Node `Buffer`) whose underlying
 * buffer is a plain `ArrayBuffer` — the only shapes used across the sync code
 * (`readLocalBinary`, `webdav.getFileContents(..., { format: 'binary' })`).
 */
function toView(value: ArrayBufferLike | Uint8Array): Uint8Array {
	if (value instanceof Uint8Array) {
		return value
	}
	return new Uint8Array(value)
}
