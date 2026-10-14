import { z } from 'zod/mini'
import createId from '~/utils/create-id'

export type JsonValue =
	null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type AppKV = Record<string, JsonValue>
export const MAX_KV_BYTES = 1_048_576
export const MAX_VALUE_BYTES = 262_144
export const APP_ROOT_DIR = '.agents/nutstore-sync/apps'
export const appIdSchema = z.string().check(z.regex(/^[a-zA-Z0-9_-]{1,100}$/))
export const sourceRefSchema = z.string().check(z.regex(/^s[1-9]\d*$/))
export const appCodeSchema = z.object({
	title: z.string().check(z.minLength(1), z.maxLength(100)),
	iconSvg: z.string().check(z.minLength(1), z.maxLength(20_000)),
	html: z.string().check(z.maxLength(160_000)),
	css: z.string().check(z.maxLength(80_000)),
	javascript: z.string().check(z.maxLength(160_000)),
	/** V1 keeps a stable JSON data contract across code upgrades. */
	dataVersion: z.literal(1),
	assets: z
		.array(
			z.object({
				name: z.string().check(z.minLength(1), z.maxLength(100)),
				dataUrl: z.string().check(z.maxLength(1_400_000)),
			}),
		)
		.check(z.maxLength(20)),
	sourceRefs: z.array(sourceRefSchema).check(z.maxLength(60)),
})
export type AppCode = z.infer<typeof appCodeSchema>
export type SourceRefId = `s${number}`
export interface SourceRecord {
	id: SourceRefId
	pathAtCapture: string
	currentPath?: string
	titleAtCapture: string
	capturedAt: number
	fileVersion: string
	locator: { kind: 'file' } | { kind: 'heading'; heading: string }
	evidenceArtifactId: string
	toolCallId: string
}
/** Saved revisions carry their evidence; deleting the build conversation cannot break them. */
export interface AppEvidence {
	source: SourceRecord
	content: string
}
export interface AppRevision {
	schemaVersion: 1
	id: string
	parentRevisionId: string | null
	createdAt: number
	code: AppCode
	evidence: AppEvidence[]
}
export interface AppRecord {
	schemaVersion: 1
	id: string
	createdAt: number
	updatedAt: number
	currentRevisionId: string
	revisionIds: string[]
	pinned: boolean
	/** Single authoritative state, committed together with the selected code revision. */
	kv: AppKV
}
export interface SavedApp {
	record: AppRecord
	revision: AppRevision
}
export interface AppBuildTurn {
	id: string
	text: string
	createdAt: number
	finishedAt?: number
	status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'
	messageIds: string[]
	revisionId?: string
	sourceRefs: SourceRefId[]
	error?: string
}
export interface WorkshopHistory {
	schemaVersion: 1
	appId?: string
	/** Before saving, code and KV belong to the draft conversation. */
	draftRevision?: AppRevision
	draftKV: AppKV
	turns: AppBuildTurn[]
	sources: Record<SourceRefId, SourceRecord>
	nextSource: number
	draft: string
}
export function createWorkshopHistory(): WorkshopHistory {
	return {
		schemaVersion: 1,
		draftKV: {},
		turns: [],
		sources: {},
		nextSource: 1,
		draft: '',
	}
}
export function createAppBuildTurn(text: string): AppBuildTurn {
	return {
		id: createId('app-build'),
		text,
		createdAt: Date.now(),
		status: 'running',
		messageIds: [],
		sourceRefs: [],
	}
}
export function recoverWorkshopHistory(history: WorkshopHistory) {
	let changed = false
	for (const turn of history.turns) {
		if (turn.status === 'running') {
			turn.status = 'interrupted'
			turn.finishedAt = Date.now()
			changed = true
		}
	}
	return changed
}
/** Reject lossy JSON values, cycles and prototype keys at every storage/bridge boundary. */
export function jsonValue(value: unknown, depth = 0): JsonValue {
	if (depth > 24) throw new Error('App data nesting limit exceeded')
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return value
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (Array.isArray(value))
		return value.map((item) => jsonValue(item, depth + 1))
	if (
		value &&
		typeof value === 'object' &&
		Object.getPrototypeOf(value) === Object.prototype
	) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => {
				validateKey(key)
				return [key, jsonValue(entry, depth + 1)]
			}),
		)
	}
	throw new Error('App data must be JSON')
}
export function validateKey(key: unknown): asserts key is string {
	if (
		typeof key !== 'string' ||
		!key.length ||
		key.length > 200 ||
		['__proto__', 'constructor', 'prototype'].includes(key)
	)
		throw new Error('Invalid App data key')
}
export function jsonBytes(value: unknown) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
export function validateKV(value: unknown): AppKV {
	const kv = jsonValue(value)
	if (!kv || typeof kv !== 'object' || Array.isArray(kv))
		throw new Error('App data must be a JSON object')
	if (jsonBytes(kv) > MAX_KV_BYTES)
		throw new Error('App data capacity exceeded')
	for (const entry of Object.values(kv))
		if (jsonBytes(entry) > MAX_VALUE_BYTES)
			throw new Error('App data value exceeds its limit')
	return kv
}
export interface KVChange {
	key: string
	value?: JsonValue
	delete?: boolean
}
export function changeKV(previous: AppKV, changes: KVChange[]): AppKV {
	if (!changes.length || changes.length > 100)
		throw new Error('Invalid App data transaction')
	const next = { ...previous }
	for (const change of changes) {
		validateKey(change.key)
		if (change.delete) delete next[change.key]
		else {
			const value = jsonValue(change.value)
			if (jsonBytes(value) > MAX_VALUE_BYTES)
				throw new Error('App data value exceeds its limit')
			next[change.key] = value
		}
	}
	if (jsonBytes(next) > MAX_KV_BYTES)
		throw new Error('App data capacity exceeded')
	return next
}
