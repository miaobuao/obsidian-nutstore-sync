import { describe, expect, it } from 'vitest'
import {
	compileFilterRules,
	type GlobFilterRule,
	isPathIncluded,
} from './glob-match'

const cases = [
	{
		name: 'basename',
		path: 'draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'basename',
		path: 'notes/draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'basename',
		path: '草稿.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'basename',
		path: 'draft.md.bak',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'basename',
		path: 'DRAFT.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'basename',
		path: 'a/b/draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'basename',
		path: 'draft-md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'basename',
		path: '.draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: 'draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'root anchor',
		path: 'notes/draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: '草稿/draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: 'DRAFT.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: 'draft.md.bak',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: 'a/draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: 'draft-md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root anchor',
		path: '.draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/draft.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'slash relative',
		path: 'docs/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'slash relative',
		path: 'docs/说明.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'slash relative',
		path: 'docs/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'slash relative',
		path: 'docs/deep/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'slash relative',
		path: 'archive/docs/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'slash relative',
		path: 'documentation/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'slash relative',
		path: 'docs/.draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'slash relative',
		path: 'docs/a.md.bak',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'docs/*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'directory only',
		path: 'cache',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'directory only',
		path: 'cache',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'directory only',
		path: 'cache/item.json',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'directory only',
		path: 'src/cache/item.json',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'directory only',
		path: 'src/cache',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'directory only',
		path: 'cached/item.json',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'directory only',
		path: '资料/cache/条目.json',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'directory only',
		path: 'cache.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'cache/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'single star',
		path: 'a.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'single star',
		path: 'notes/a.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'single star',
		path: '笔记/草稿.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'single star',
		path: 'a.tmp.bak',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'single star',
		path: '.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'single star',
		path: 'a.TMP',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'single star',
		path: 'tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'single star',
		path: 'deep/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'question mark',
		path: 'result1.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'question mark',
		path: 'resultA.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'question mark',
		path: 'result12.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'question mark',
		path: 'result.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'question mark',
		path: 'src/result1.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'question mark',
		path: 'result-.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'question mark',
		path: 'result1.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'question mark',
		path: '.result1.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'result?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'range',
		path: 'part0.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'range',
		path: 'part9.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'range',
		path: 'partA.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'range',
		path: 'part10.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'range',
		path: 'notes/part5.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'range',
		path: 'part-.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'range',
		path: 'part5.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'range',
		path: '章节5.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'negated range',
		path: 'partA.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'negated range',
		path: 'part-.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'negated range',
		path: 'part5.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'negated range',
		path: 'part10.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'negated range',
		path: 'notes/partZ.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'negated range',
		path: 'part_.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'negated range',
		path: 'part.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'negated range',
		path: '章节A.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'part[!0-9].md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'posix digit class',
		path: 'item-0.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'posix digit class',
		path: 'item-9.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'posix digit class',
		path: 'item-a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'posix digit class',
		path: 'item-10.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'posix digit class',
		path: 'notes/item-5.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'posix digit class',
		path: 'item--.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'posix digit class',
		path: 'item-5.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'posix digit class',
		path: '项目-5.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'item-[[:digit:]].txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'report.{md,txt}',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'literal braces',
		path: 'report.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'report.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'notes/report.{md,txt}',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'literal braces',
		path: '报告.{md,txt}',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'report.csv',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'report.{md}',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal braces',
		path: 'reportmdtxt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'report.{md,txt}',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'name?.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'escaped question',
		path: 'name1.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'notes/name?.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'escaped question',
		path: '名称?.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'nameA.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'name??.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'name.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped question',
		path: 'name?.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'name\\?.txt',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: 'version*.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'escaped star',
		path: 'version1.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: 'notes/version*.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'escaped star',
		path: '版本*.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: 'version.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: 'version**.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: 'version*.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'escaped star',
		path: '*version.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'version\\*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'leading globstar',
		path: 'logs',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'leading globstar',
		path: 'work/logs',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'leading globstar',
		path: '工作/历史/logs',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'leading globstar',
		path: 'catalogs',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'leading globstar',
		path: 'logs.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'leading globstar',
		path: 'a/logs/b.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'leading globstar',
		path: 'log',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'leading globstar',
		path: 'a/b/logs',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '**/logs',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'trailing globstar',
		path: 'archive',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'trailing globstar',
		path: 'archive/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'trailing globstar',
		path: 'archive/资料/条目.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'trailing globstar',
		path: 'nested/archive/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'trailing globstar',
		path: 'archive.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'trailing globstar',
		path: 'archives/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'trailing globstar',
		path: 'archive/.keep',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'trailing globstar',
		path: 'archive/a/b/c.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'archive/**',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'a/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'a/x/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'a/x/y/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'x/a/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'middle globstar',
		path: 'a/中/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'a/b.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'middle globstar',
		path: 'a/x/b/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'middle globstar',
		path: 'ab',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**/b',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'non-segment double star',
		path: 'a/b/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'non-segment double star',
		path: 'a/xxb/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'non-segment double star',
		path: 'a/x/yb/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'non-segment double star',
		path: 'a/中b/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'non-segment double star',
		path: 'x/a/b/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'non-segment double star',
		path: 'a/bb/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'non-segment double star',
		path: 'a/x/c',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'non-segment double star',
		path: 'a/b/c/d',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'a/**b/c',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: '.draft',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: 'notes/.draft',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: '目录/.草稿',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: 'draft',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'dot names',
		path: 'a.draft',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'dot names',
		path: '.config/settings.json',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: '.gitignore',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'dot names',
		path: 'notes/visible.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '.*',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'leaf reinclusion',
		path: 'keep.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'leaf reinclusion',
		path: 'notes/keep.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'leaf reinclusion',
		path: 'drop.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'leaf reinclusion',
		path: 'notes/drop.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'leaf reinclusion',
		path: '保留.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'leaf reinclusion',
		path: 'keep.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'leaf reinclusion',
		path: 'a/keep.tmp/b',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'leaf reinclusion',
		path: '.keep.tmp',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '*.tmp',
				type: 'exclude',
			},
			{
				expr: 'keep.tmp',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: 'private',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: 'private/readme.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: 'private/说明.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: 'public/readme.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'excluded parent pruning',
		path: 'nested/private/readme.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: 'private.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'excluded parent pruning',
		path: 'private/deep/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'excluded parent pruning',
		path: '公开/说明.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'private/',
				type: 'exclude',
			},
			{
				expr: 'private/readme.md',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'parent reinclusion',
		path: 'docs',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'parent reinclusion',
		path: 'docs/guide.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'parent reinclusion',
		path: 'docs/指南.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'parent reinclusion',
		path: 'other/file.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'parent reinclusion',
		path: 'other',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'parent reinclusion',
		path: 'docs/deep/a.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'parent reinclusion',
		path: 'readme.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'parent reinclusion',
		path: '资料/说明.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/*',
				type: 'exclude',
			},
			{
				expr: '/docs',
				type: 'include',
			},
			{
				expr: '/docs/**',
				type: 'include',
			},
		],
		included: false,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace/note.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace/笔记.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace/generated/other.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace/generated',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'other/note.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace/generated/deep/a.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: 'workspace.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'nested exclusion after reinclusion',
		path: '工作区/笔记.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'workspace/',
				type: 'exclude',
			},
			{
				expr: 'workspace',
				type: 'include',
			},
			{
				expr: 'workspace/**',
				type: 'include',
			},
			{
				expr: 'workspace/generated/',
				type: 'exclude',
			},
			{
				expr: 'workspace/generated',
				type: 'include',
			},
		],
		included: true,
	},
	{
		name: 'case-sensitive',
		path: 'Draft.MD',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-sensitive',
		path: 'DraftOne.MD',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-sensitive',
		path: 'draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-sensitive',
		path: 'DRAFT.MD',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-sensitive',
		path: 'notes/DraftTwo.MD',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-sensitive',
		path: 'DraftOne.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-sensitive',
		path: '草稿.MD',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-sensitive',
		path: 'Draft.MD.bak',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-insensitive',
		path: 'Draft.MD',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: 'DraftOne.MD',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: 'draft.md',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: 'DRAFT.MD',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: 'notes/drafttwo.md',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: 'DraftOne.md',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'case-insensitive',
		path: '草稿.MD',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'case-insensitive',
		path: 'Draft.MD.bak',
		isDir: false,
		caseSensitive: false,
		rules: [
			{
				expr: 'Draft*.MD',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal Chinese with star',
		path: '草稿.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'literal Chinese with star',
		path: '草稿一.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'literal Chinese with star',
		path: '笔记/草稿二.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'literal Chinese with star',
		path: '草稿.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal Chinese with star',
		path: '正式稿.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal Chinese with star',
		path: 'draft.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal Chinese with star',
		path: '草稿/说明.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'literal Chinese with star',
		path: '.草稿.md',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '草稿*.md',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: 'vendor',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'root directory',
		path: 'vendor',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: 'vendor/a.js',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'root directory',
		path: 'src/vendor/a.js',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: 'src/vendor',
		isDir: true,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: 'vendors/a.js',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: 'vendor.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'root directory',
		path: '供应商/a.js',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: '/vendor/',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'ordinary repeated stars',
		path: 'abcd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'ordinary repeated stars',
		path: 'abXXcd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'ordinary repeated stars',
		path: 'notes/abXXcd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'ordinary repeated stars',
		path: 'ab/x/cd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'ordinary repeated stars',
		path: 'ab中cd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: false,
	},
	{
		name: 'ordinary repeated stars',
		path: 'abXXcd.txt',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'ordinary repeated stars',
		path: 'aXXcd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: true,
	},
	{
		name: 'ordinary repeated stars',
		path: 'abccd',
		isDir: false,
		caseSensitive: true,
		rules: [
			{
				expr: 'ab**cd',
				type: 'exclude',
			},
		],
		included: false,
	},
] as const

describe('Git-generated filter-rule oracle', () => {
	it('contains a broad compatibility corpus', () => {
		expect(cases.length).toBeGreaterThanOrEqual(200)
	})

	it.each(cases)('$name: $path -> included=$included', (testCase) => {
		const rules: GlobFilterRule[] = testCase.rules.map((candidate) => ({
			...candidate,
			options: { caseSensitive: testCase.caseSensitive },
		}))
		expect(
			isPathIncluded(testCase.path, compileFilterRules(rules), testCase.isDir),
		).toBe(testCase.included)
	})
})
