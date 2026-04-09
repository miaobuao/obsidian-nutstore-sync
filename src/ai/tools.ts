import { App, normalizePath, TFile } from 'obsidian'
import { posix as pathPosix } from 'path-browserify'
import { z } from 'zod'
import { execVaultBash, VAULT_MOUNT_POINT } from '~/ai/bash/runtime'
import i18n from '~/i18n'
import { AIToolDefinition } from './types'

interface ReplaceResult {
	content: string
	matchCount: number
}

const textValue = (field: string) =>
	z.string({
		error: () => i18n.t('chatbox.errors.toolFieldRequired', { field }),
	})

const booleanValue = (field: string) =>
	z.preprocess(
		(value) => {
			if (typeof value === 'boolean') {
				return value
			}
			if (typeof value === 'string') {
				const normalized = value.trim().toLowerCase()
				if (normalized === 'true') {
					return true
				}
				if (normalized === 'false') {
					return false
				}
			}
			return value
		},
		z.boolean(i18n.t('chatbox.errors.toolFieldRequired', { field })),
)

function isAllowedBashCwd(pathValue: string) {
	const normalized = pathPosix.normalize(
		pathPosix.resolve('/', pathValue || '/'),
	)
	return (
		normalized === '/' ||
		normalized === VAULT_MOUNT_POINT ||
		normalized.startsWith(`${VAULT_MOUNT_POINT}/`)
	)
}

interface SpawnToolHandler {
	(params: {
		task: string
		label?: string
		parentTaskId?: string
		depth: number
		maxDepth: number
		sessionId: string
	}): Promise<Record<string, unknown>>
}

interface CreateAIToolsOptions {
	spawnTask?: SpawnToolHandler
	allowSpawn?: boolean
}

function replaceUniqueOccurrence(
	content: string,
	oldText: string,
	newText: string,
) {
	let matchIndex = content.indexOf(oldText)
	let matchCount = 0

	while (matchIndex !== -1) {
		matchCount += 1
		if (matchCount > 1) {
			break
		}
		matchIndex = content.indexOf(oldText, matchIndex + oldText.length)
	}

	if (matchCount === 0) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotFound'))
	}
	if (matchCount > 1) {
		throw new Error(i18n.t('chatbox.errors.editMatchNotUnique'))
	}

	return {
		content: content.replace(oldText, newText),
		matchCount,
	} satisfies ReplaceResult
}

export function createAITools(
	app: App,
	options: CreateAIToolsOptions = {},
): AIToolDefinition[] {
	const tools: AIToolDefinition[] = [
		{
			name: 'edit_file',
			description:
				'Edit a vault text file by replacing one exact, uniquely matched text block with new text.',
			inputSchema: z.object({
				path: z
					.string()
					.trim()
					.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'path' })),
				oldText: z
					.string()
					.min(
						1,
						i18n.t('chatbox.errors.toolFieldRequired', { field: 'oldText' }),
					),
				newText: textValue('newText'),
			}),
			execute: async (params) => {
				const path = params.path
				const oldText = params.oldText
				const newText = params.newText
				const normalizedPath = normalizePath(path)
				const target = app.vault.getAbstractFileByPath(normalizedPath)

				if (!target) {
					throw new Error(i18n.t('chatbox.errors.fileNotFound', { path }))
				}
				if (!(target instanceof TFile)) {
					throw new Error(i18n.t('chatbox.errors.notFile', { path }))
				}

				const content = await app.vault.cachedRead(target)
				const replaced = replaceUniqueOccurrence(content, oldText, newText)
				await app.vault.modify(target, replaced.content)

				return {
					path: normalizedPath,
					replaced: true,
					matchCount: replaced.matchCount,
				}
			},
		},
		{
			name: 'bash',
			description:
				'Execute bash against a virtual filesystem where the Obsidian vault is mounted at /vault. Use standard shell commands like ls, cat, rg, mkdir, mv, cp, and rm.',
			inputSchema: z.object({
				script: textValue('script'),
				cwd: z.string().default(VAULT_MOUNT_POINT),
				stdin: z.string().optional(),
				rawScript: booleanValue('rawScript').default(false),
			}),
			execute: async (params) => {
				const cwd = params.cwd || VAULT_MOUNT_POINT
				if (!isAllowedBashCwd(cwd)) {
					throw new Error(
						`Invalid bash cwd: ${cwd}. Allowed roots are / and ${VAULT_MOUNT_POINT}`,
					)
				}

				const result = await execVaultBash(app, params.script, {
					cwd,
					stdin: params.stdin,
					rawScript: params.rawScript,
				})

				return `${result.stdout}${result.stderr}`
			},
		},
	]

	if (options.spawnTask && options.allowSpawn !== false) {
		tools.push({
			name: 'spawn',
			description:
				'Run a large independent background task and return its task result when finished.',
			inputSchema: z.object({
				task: z
					.string()
					.trim()
					.min(1, i18n.t('chatbox.errors.toolFieldRequired', { field: 'task' })),
				label: z.string().trim().optional(),
			}),
			execute: async (params, context) => {
				return options.spawnTask!({
					task: params.task,
					label: params.label,
					parentTaskId: context.parentTaskId,
					depth: context.depth + 1,
					maxDepth: context.maxDepth,
					sessionId: context.session.id,
				})
			},
		})
	}

	return tools
}
