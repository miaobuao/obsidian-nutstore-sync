import { describe, expect, it } from 'vitest'
import GlobMatch, {
	compileFilterRules,
	GlobFilterRule,
	isPathIncluded,
	migrateLegacyFilterRules,
} from './glob-match'

const options = { caseSensitive: false }

const makeRules = (
	patterns: string[],
	type: 'include' | 'exclude' = 'exclude',
): GlobFilterRule[] =>
	patterns.map((pattern) => ({ expr: pattern, options, type }))

const decide = (path: string, rules: GlobFilterRule[]) =>
	isPathIncluded(path, compileFilterRules(rules), path.endsWith('/'))

describe('isPathIncluded (last-match-wins rules)', () => {
	it('默认情况：无规则时应包含所有路径', () => {
		expect(decide('some/file.txt', [])).toBe(true)
		expect(decide('some/../file.txt', [])).toBe(true)
		expect(decide('./some/file.txt', [])).toBe(true)
		expect(decide('some//file.txt', [])).toBe(true)
		expect(decide('/some/file.txt', [])).toBe(true)
		expect(decide('some/folder/..', [])).toBe(true)
		expect(decide('some/folder/../', [])).toBe(true)
		expect(decide('some/././file.txt', [])).toBe(true)
	})

	it('排除规则命中叶子时被排除', () => {
		expect(decide('debug.log', makeRules(['*.log']))).toBe(false)
		expect(decide('readme.md', makeRules(['*.log']))).toBe(true)
	})

	it('包含规则命中叶子时被包含', () => {
		expect(decide('document.txt', makeRules(['*.txt'], 'include'))).toBe(true)
	})

	it('last-match：同路径上后写的规则覆盖先写的规则', () => {
		const rules = [
			...makeRules(['*.log'], 'exclude'),
			...makeRules(['important.log'], 'include'),
		]
		expect(decide('important.log', rules)).toBe(true)
		expect(decide('debug.log', rules)).toBe(false)
	})

	it('last-match：后写的排除可以压过先写的包含', () => {
		const rules = [
			...makeRules(['*.md'], 'include'),
			...makeRules(['private', 'private/**'], 'exclude'),
		]
		expect(decide('docs/readme.md', rules)).toBe(true)
		expect(decide('docs/private/note.md', rules)).toBe(false)
	})

	it('normalization keeps relative and trailing separators stable', () => {
		expect(decide('docs/readme.md', [])).toBe(true)
	})
})

describe('GlobMatch pattern semantics', () => {
	it('* 匹配零个或多个字符，但不跨目录', () => {
		const exclusion = makeRules(['*.txt'])
		expect(decide('readme.txt', exclusion)).toBe(false)
		expect(decide('readme.txt/', exclusion)).toBe(false)
		expect(decide('notes/readme.txt', exclusion)).toBe(false)
		expect(decide('notes/archive/readme.txt', exclusion)).toBe(false)
		expect(decide('notes/readme.txt.bak', exclusion)).toBe(true)
		expect(decide('readme.md', exclusion)).toBe(true)
		expect(decide('readme', exclusion)).toBe(true)
		expect(decide('dir.with.dot/readme.txt', exclusion)).toBe(false)
	})

	it('? 匹配任意单个字符', () => {
		const exclusion = makeRules(['debug?.log'])
		expect(decide('debug1.log', exclusion)).toBe(false)
		expect(decide('debugA.log', exclusion)).toBe(false)
		expect(decide('debug12.log', exclusion)).toBe(true)
		expect(decide('debug.log', exclusion)).toBe(true)
		expect(decide('debug/.log', exclusion)).toBe(true)
		expect(decide('debugä.log', exclusion)).toBe(false)
	})

	it('[] 匹配指定字符或范围', () => {
		const exclusion = makeRules(['backup[0-9].sql'])
		expect(decide('backup0.sql', exclusion)).toBe(false)
		expect(decide('backup9.sql', exclusion)).toBe(false)
		expect(decide('backupA.sql', exclusion)).toBe(true)
		expect(decide('backup10.sql', exclusion)).toBe(true)
		expect(decide('backup-.sql', exclusion)).toBe(true)
		expect(decide('backup5.SQL', exclusion)).toBe(false)
	})

	it('大小写：默认 case-insensitive，可强制 sensitive', () => {
		const insensitive = makeRules(['debug?.log'])
		expect(decide('DEBUG1.LOG', insensitive)).toBe(false)
		const sensitive = [
			{
				expr: 'backup[0-9].sql',
				options: { caseSensitive: true },
				type: 'exclude' as const,
			},
		]
		expect(decide('backup0.sql', sensitive)).toBe(false)
		expect(decide('BACKUP0.SQL', sensitive)).toBe(true)
	})
})

describe('路径分隔符规则', () => {
	it('模式中不包含 /：递归匹配所有目录', () => {
		const exclusion = makeRules(['*.log', 'temp'])
		expect(decide('app.log', exclusion)).toBe(false)
		expect(decide('logs/app.log', exclusion)).toBe(false)
		expect(decide('logs/app.log/', exclusion)).toBe(false)
		expect(decide('temp', exclusion)).toBe(false)
		expect(decide('src/temp', exclusion)).toBe(false)
		expect(decide('src/temp/file.txt', exclusion)).toBe(false)
		expect(decide('src/temp/../temp/file.txt', exclusion)).toBe(false)
		expect(decide('src/./temp/file.txt', exclusion)).toBe(false)
		expect(decide('TEMP', exclusion)).toBe(false)
		expect(decide('temporary/file.txt', exclusion)).toBe(true)
	})

	it('模式以 / 开头：仅匹配根目录', () => {
		const exclusion = makeRules(['/TODO'])
		expect(decide('TODO', exclusion)).toBe(false)
		expect(decide('src/TODO', exclusion)).toBe(true)
		expect(decide('TODO/readme.md', exclusion)).toBe(false)
		expect(decide('todo', exclusion)).toBe(false)
		expect(decide('src/../TODO', exclusion)).toBe(false)
		expect(decide('/TODO', exclusion)).toBe(false)
		expect(decide('nested/TODO', exclusion)).toBe(true)
	})

	it('模式以 / 结尾：仅匹配目录及其内容', () => {
		const exclusion = makeRules(['build/'])
		expect(decide('build/', exclusion)).toBe(false)
		expect(decide('build/app.js', exclusion)).toBe(false)
		expect(decide('src/build/', exclusion)).toBe(false)
		expect(decide('src/build/app.js', exclusion)).toBe(false)
		expect(decide('build', exclusion)).toBe(true)
		expect(decide('buildfile/', exclusion)).toBe(true)
		expect(decide('build/../build/app.js', exclusion)).toBe(false)
	})

	it('模式中间包含 /：相对路径匹配', () => {
		const exclusion = makeRules(['doc/*.txt'])
		expect(decide('doc/a.txt', exclusion)).toBe(false)
		expect(decide('doc/server/arch.txt', exclusion)).toBe(true)
		expect(decide('docs/a.txt', exclusion)).toBe(true)
		expect(decide('doc/a.txt/', exclusion)).toBe(false)
		expect(decide('doc/a.tx', exclusion)).toBe(true)
	})
})

describe('双星号 ** 深度匹配', () => {
	it('**/pattern：任意深度匹配文件名', () => {
		const exclusion = makeRules(['**/__pycache__'])
		expect(decide('__pycache__', exclusion)).toBe(false)
		expect(decide('src/__pycache__', exclusion)).toBe(false)
		expect(decide('src/utils/__pycache__', exclusion)).toBe(false)
		expect(decide('src/utils/__pycache__/', exclusion)).toBe(false)
		expect(decide('src/utils/__pycache__x', exclusion)).toBe(true)
		expect(decide('src/__pycache__/file.py', exclusion)).toBe(false)
	})

	it('pattern/**：匹配该目录下所有内容', () => {
		const exclusion = makeRules(['assets/**'])
		expect(decide('assets/logo.png', exclusion)).toBe(false)
		expect(decide('assets/icons/icon.svg', exclusion)).toBe(false)
		expect(decide('assets', exclusion)).toBe(true)
		expect(decide('src/assets/logo.png', exclusion)).toBe(true)
		expect(decide('assets/.keep', exclusion)).toBe(false)
	})

	it('pattern/**/pattern：跨层级匹配', () => {
		const exclusion = makeRules(['foo/**/bar'])
		expect(decide('foo/bar', exclusion)).toBe(false)
		expect(decide('foo/x/bar', exclusion)).toBe(false)
		expect(decide('foo/x/y/bar', exclusion)).toBe(false)
		expect(decide('x/foo/bar', exclusion)).toBe(true)
		expect(decide('foo/bar/baz', exclusion)).toBe(false)
		expect(decide('foo/.hidden/bar', exclusion)).toBe(false)
	})
})

describe('父目录剪枝（gitignore 语义）', () => {
	it('父目录被排除时，子路径应直接被排除', () => {
		const exclusion = makeRules(['build/'])
		expect(decide('build/', exclusion)).toBe(false)
		expect(decide('build/app.js', exclusion)).toBe(false)
		expect(decide('build/sub/app.js', exclusion)).toBe(false)
		expect(decide('build/sub/', exclusion)).toBe(false)
	})

	it('被剪枝的父目录下，单独的子树白名单无法拉回', () => {
		const rules = [
			...makeRules(['build/'], 'exclude'),
			...makeRules(['build/keep.txt'], 'include'),
		]
		expect(decide('build/keep.txt', rules)).toBe(false)
		expect(decide('build/keep/more.txt', rules)).toBe(false)
	})

	it('先放回父目录本身，再放回子树即可恢复', () => {
		const rules = [
			...makeRules(['build/'], 'exclude'),
			...makeRules(['build', 'build/**'], 'include'),
			...makeRules(['build/skip/'], 'exclude'),
		]
		expect(decide('build/keep.txt', rules)).toBe(true)
		expect(decide('build/keep/more.txt', rules)).toBe(true)
		expect(decide('build/skip/secret.md', rules)).toBe(false)
	})

	it('规则同样以 last-match 作用于祖先目录本身', () => {
		const rules = [
			...makeRules(['**/.*'], 'exclude'),
			...makeRules(['.obsidian', '.obsidian/**'], 'include'),
		]
		expect(decide('.obsidian', rules)).toBe(true)
		expect(decide('.obsidian/app.json', rules)).toBe(true)
		expect(decide('.obsidian/plugins/sample/main.js', rules)).toBe(true)
		expect(decide('notes/note.md', rules)).toBe(true)
		expect(decide('.trash', rules)).toBe(false)
	})

	it('放回父目录时不能覆盖更深层的系统排除', () => {
		const rules = [
			...makeRules(['**/.*'], 'exclude'),
			...makeRules(['.obsidian', '.obsidian/**'], 'include'),
			...makeRules(['.obsidian/plugins/**/node_modules'], 'exclude'),
		]
		expect(decide('.obsidian/plugins/sample/main.js', rules)).toBe(true)
		expect(
			decide('.obsidian/plugins/sample/node_modules/pkg/index.js', rules),
		).toBe(false)
	})
})

describe('综合示例规则', () => {
	const exclusion = makeRules([
		'*.a',
		'bin/',
		'/vendor/',
		'logs/*.txt',
		'core/**/*.out',
		'test[0-9].js',
	])

	it('*.a：匹配所有目录下的 .a 文件', () => {
		expect(decide('lib.a', exclusion)).toBe(false)
		expect(decide('src/lib.a', exclusion)).toBe(false)
		expect(decide('src/lib.so', exclusion)).toBe(true)
		expect(decide('src/lib.a/', exclusion)).toBe(false)
		expect(decide('src/lib.a.bak', exclusion)).toBe(true)
	})

	it('bin/：忽略任意位置的 bin 目录', () => {
		expect(decide('bin/tool', exclusion)).toBe(false)
		expect(decide('src/bin/tool', exclusion)).toBe(false)
		expect(decide('binfile', exclusion)).toBe(true)
		expect(decide('src/binfile/tool', exclusion)).toBe(true)
		expect(decide('bin/../bin/tool', exclusion)).toBe(false)
	})

	it('/vendor/：仅忽略根目录的 vendor', () => {
		expect(decide('vendor/lib.js', exclusion)).toBe(false)
		expect(decide('src/vendor/lib.js', exclusion)).toBe(true)
		expect(decide('vendor', exclusion)).toBe(true)
		expect(decide('vendor/', exclusion)).toBe(false)
		expect(decide('src/../vendor/lib.js', exclusion)).toBe(false)
	})

	it('logs/*.txt：仅匹配 logs 下一级 .txt', () => {
		expect(decide('logs/app.txt', exclusion)).toBe(false)
		expect(decide('logs/history/2023.txt', exclusion)).toBe(true)
		expect(decide('logs/app.txt/', exclusion)).toBe(false)
		expect(decide('logs/app.tx', exclusion)).toBe(true)
	})

	it('core/**/*.out：匹配 core 下任意深度 .out', () => {
		expect(decide('core/main.out', exclusion)).toBe(false)
		expect(decide('core/a/b/c/test.out', exclusion)).toBe(false)
		expect(decide('src/core/test.out', exclusion)).toBe(true)
		expect(decide('core/test.out/', exclusion)).toBe(false)
		expect(decide('core/test.output', exclusion)).toBe(true)
	})

	it('test[0-9].js：匹配 test0.js ~ test9.js', () => {
		expect(decide('test0.js', exclusion)).toBe(false)
		expect(decide('test9.js', exclusion)).toBe(false)
		expect(decide('test10.js', exclusion)).toBe(true)
		expect(decide('testA.js', exclusion)).toBe(true)
		expect(decide('test0.js/', exclusion)).toBe(false)
		expect(decide('test5.js.map', exclusion)).toBe(true)
	})
})

describe('GlobMatch unit behavior', () => {
	it('matches dot-prefixed basenames for **/.*', () => {
		const match = new GlobMatch('**/.*', { caseSensitive: false })
		expect(match.test('.obsidian')).toBe(true)
		expect(match.test('.obsidian/app.json')).toBe(false)
		expect(match.test('notes/.hidden')).toBe(true)
		expect(match.test('notes/visible.md')).toBe(false)
	})
})

describe('migrateLegacyFilterRules', () => {
	it('passes through the current single-list shape unchanged', () => {
		const rule: GlobFilterRule = {
			expr: '**/.*',
			options: { caseSensitive: false },
			type: 'exclude',
		}
		const legacy = { rules: [rule] }
		expect(migrateLegacyFilterRules(legacy)).toEqual({
			...legacy,
			migrated: false,
		})
	})

	it('merges legacy exclusion and inclusion lists into one ordered list', () => {
		const legacy = {
			exclusionRules: [
				{ expr: '**/.*', options: { caseSensitive: false } },
				{ expr: '**/.DS_Store', options: { caseSensitive: false } },
			],
			inclusionRules: [
				{ expr: '.obsidian', options: { caseSensitive: false } },
			],
		}
		expect(migrateLegacyFilterRules(legacy)).toEqual({
			rules: [
				{ expr: '**/.*', options: { caseSensitive: false }, type: 'exclude' },
				{
					expr: '**/.DS_Store',
					options: { caseSensitive: false },
					type: 'exclude',
				},
				{
					expr: '.obsidian',
					options: { caseSensitive: false },
					type: 'include',
				},
			],
			migrated: true,
		})
	})

	it('preserves case sensitivity flags during migration', () => {
		const legacy = {
			exclusionRules: [],
			inclusionRules: [{ expr: '.obsidian', options: { caseSensitive: true } }],
		}
		expect(
			migrateLegacyFilterRules(legacy).rules[0].options.caseSensitive,
		).toBe(true)
		expect(migrateLegacyFilterRules(legacy).rules[0].type).toBe('include')
	})

	it('normalizes empty or undefined filter rules without marking migration', () => {
		expect(migrateLegacyFilterRules(undefined)).toEqual({
			rules: [],
			migrated: false,
		})
		expect(migrateLegacyFilterRules({})).toEqual({ rules: [], migrated: false })
	})

	it('only marks migration when legacy split keys were present', () => {
		const onlyExclusions = { exclusionRules: [], inclusionRules: [] }
		expect(migrateLegacyFilterRules(onlyExclusions).migrated).toBe(true)
	})

	it('is idempotent: migrating a migrated shape returns an equivalent list', () => {
		const once = migrateLegacyFilterRules({
			exclusionRules: [{ expr: '**/.*', options: { caseSensitive: false } }],
			inclusionRules: [{ expr: '*.md', options: { caseSensitive: false } }],
		})
		const twice = migrateLegacyFilterRules(once)
		expect(twice.rules).toEqual(once.rules)
		expect(twice.migrated).toBe(false)
	})
})

describe('disabled filter rules', () => {
	it('a disabled exclude no longer matches', () => {
		const rules: GlobFilterRule[] = [
			{ expr: '*.log', options, type: 'exclude', disabled: true },
		]
		expect(decide('debug.log', rules)).toBe(true)
	})

	it('a disabled include does not resurrect paths', () => {
		const rules: GlobFilterRule[] = [
			{ expr: '*.log', options, type: 'exclude' },
			{ expr: 'important.log', options, type: 'include', disabled: true },
		]
		expect(decide('important.log', rules)).toBe(false)
	})

	it('absent disabled means the rule stays active', () => {
		const rules: GlobFilterRule[] = [
			{ expr: '*.log', options, type: 'exclude' },
		]
		expect(decide('debug.log', rules)).toBe(false)
	})

	it('disabled rules do not prune their subtree', () => {
		const rules: GlobFilterRule[] = [
			{ expr: 'private', options, type: 'exclude', disabled: true },
		]
		expect(decide('private/note.md', rules)).toBe(true)
	})
})
