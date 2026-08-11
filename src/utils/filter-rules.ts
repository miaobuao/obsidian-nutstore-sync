import path from 'path-browserify'
import GlobMatch, {
	type GlobMatchOptions,
	type GlobMatchUserOptions,
	isVoidGlobMatchOptions,
} from './gitignore-pattern'

export type FilterRuleType = 'include' | 'exclude'

export interface GlobFilterRule extends GlobMatchOptions {
	type: FilterRuleType
}

export interface CompiledFilterRule {
	match: GlobMatch
	type: FilterRuleType
}

export function compileFilterRules(
	rules: GlobFilterRule[] = [],
): CompiledFilterRule[] {
	return rules
		.filter((rule) => !isVoidGlobMatchOptions(rule))
		.map((rule) => ({
			match: new GlobMatch(rule.expr, rule.options),
			type: rule.type,
		}))
}

export interface LegacyFilterRules {
	exclusionRules?: GlobMatchOptions[]
	inclusionRules?: GlobMatchOptions[]
	rules?: GlobFilterRule[]
}

export function migrateLegacyFilterRules(
	filterRules: LegacyFilterRules | undefined,
): { rules: GlobFilterRule[]; migrated: boolean } {
	const source = filterRules ?? {}
	if (Array.isArray(source.rules)) {
		return { rules: [...source.rules], migrated: false }
	}
	const hasLegacyKeys =
		Array.isArray(source.exclusionRules) || Array.isArray(source.inclusionRules)
	const exclusions = (source.exclusionRules ?? []).map((rule) => ({
		...rule,
		type: 'exclude' as const,
	}))
	const inclusions = (source.inclusionRules ?? []).map((rule) => ({
		...rule,
		type: 'include' as const,
	}))
	return {
		rules: [...exclusions, ...inclusions],
		migrated: hasLegacyKeys,
	}
}

function normalizePathSegments(rawPath: string) {
	const normalized = path.normalize(rawPath)
	const trimmed = normalized.replace(/^\.+\//, '').replace(/^\/+/, '')
	const withoutTrailing = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
	return withoutTrailing ? withoutTrailing.split('/').filter(Boolean) : []
}

/** Apply ordered rules to every ancestor before deciding the leaf. */
export function isPathIncluded(
	path: string,
	rules: CompiledFilterRule[],
	isDir = false,
): boolean {
	const segments = normalizePathSegments(path)
	for (let index = 1; index <= segments.length; index += 1) {
		const isDirNode = index < segments.length || isDir
		const prefix = segments.slice(0, index).join('/')
		const candidatePath = isDirNode ? `${prefix}/` : prefix

		let last: CompiledFilterRule | undefined
		for (const rule of rules) {
			if (rule.match.test(candidatePath)) last = rule
		}

		if (isDirNode) {
			if (last?.type === 'exclude') return false
			continue
		}
		return last ? last.type === 'include' : true
	}
	return true
}

export type { GlobMatchOptions, GlobMatchUserOptions }
