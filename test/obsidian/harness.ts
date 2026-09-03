import { Plugin } from 'obsidian'
import type { PersistedChatSession } from '~/ai/chat/session/session-persistence'

export const OBSIDIAN_E2E_RESULT_PATH =
	'.obsidian/nutstore-sync-e2e-result.json'

interface TestResult {
	name: string
	error?: string
}

interface ProductionPlugin {
	isSyncing: boolean
	progressService: {
		syncProgress: {
			total: number
			completed: unknown[]
			current: unknown
		}
		preparationProgress: unknown
		syncEnd: boolean
		syncFailed: boolean
		syncFailedCount: number
		showProgressModal(): void
		closeProgressModal(): void
		updateModal: (() => void) & { flush?: () => void }
	}
}

function sessionSnapshot(id: string): PersistedChatSession {
	return {
		schemaVersion: 2,
		id,
		createdAt: 1,
		updatedAt: 2,
		subagents: {
			master: {
				id: 'master',
				type: 'master',
				status: 'idle',
				createdAt: 1,
				timeline: [],
				pendingInputs: [],
				operations: {},
				toolTimings: {},
				subagents: {},
			},
		},
	} as PersistedChatSession
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

function getProductionPlugin(app: Plugin['app']): ProductionPlugin {
	const plugins = (
		app as unknown as {
			plugins: { plugins: Record<string, unknown> }
		}
	).plugins
	const plugin = plugins.plugins['nutstore-sync'] as
		| ProductionPlugin
		| undefined
	assert(plugin, 'Nutstore Sync is not loaded')
	return plugin
}

export default class NutstoreSyncIntegrationHarness extends Plugin {
	async onload() {
		const results: TestResult[] = []
		await this.app.vault.adapter.write(
			OBSIDIAN_E2E_RESULT_PATH,
			JSON.stringify({ passed: false, started: true, results }),
		)
		const run = async (name: string, test: () => Promise<void>) => {
			try {
				await test()
				results.push({ name })
			} catch (error) {
				results.push({
					name,
					error: error instanceof Error ? error.stack : String(error),
				})
			}
		}

		await run('loads the production plugin', async () => {
			getProductionPlugin(this.app)
		})

		await run(
			'creates provider models through the real Obsidian runtime',
			async () => {
				const { getProviderResolver } = await import('~/ai/providers/registry')
				const provider = (overrides: Record<string, unknown> = {}) =>
					({
						id: 'neutral-provider',
						env: [],
						npm: '@ai-sdk/openai-compatible',
						api: 'https://example.test/v1',
						name: 'neutral provider',
						doc: '',
						apiKey: 'neutral-key',
						models: {},
						...overrides,
					}) as never
				const compatible = provider()
				assert(
					getProviderResolver(compatible).createLanguageModel(
						compatible,
						'neutral-model',
					).model.constructor.name === '_OpenAICompatibleChatLanguageModel',
					'OpenAI-compatible provider did not create its expected model',
				)
				const official = provider({ npm: '@ai-sdk/openai', api: undefined })
				assert(
					getProviderResolver(official).createLanguageModel(
						official,
						'neutral-model',
					).model.constructor.name === '_OpenAIResponsesLanguageModel',
					'Official OpenAI provider did not create its expected model',
				)
			},
		)

		await run(
			'reloads the production plugin through the real lifecycle',
			async () => {
				const plugins = (
					this.app as unknown as {
						plugins: {
							disablePlugin(id: string): Promise<void>
							enablePlugin(id: string): Promise<void>
							plugins: Record<string, unknown>
						}
					}
				).plugins
				await plugins.disablePlugin('nutstore-sync')
				await plugins.enablePlugin('nutstore-sync')
				assert(
					plugins.plugins['nutstore-sync'],
					'Production plugin did not reload through the real lifecycle',
				)
			},
		)

		await run('round-trips Vault adapter paths and content', async () => {
			const path = '.agents/nutstore-sync/e2e/中性 sample 🌱.txt'
			const content = 'neutral content / 中性内容 🌱'
			await this.app.vault.adapter.mkdir('.agents/nutstore-sync/e2e')
			await this.app.vault.adapter.write(path, content)
			assert(
				(await this.app.vault.adapter.read(path)) === content,
				'Vault adapter did not round-trip Unicode content',
			)
			await this.app.vault.adapter.remove(path)
			assert(
				!(await this.app.vault.adapter.exists(path)),
				'Vault adapter did not remove its test file',
			)
		})

		await run(
			'preserves UTF-8 when Bash writes a Vault file through a heredoc',
			async () => {
				const { execVaultBash } = await import('~/ai/tools/bash/runtime')
				const path = '.agents/nutstore-sync/e2e/中性 heredoc 🌱.md'
				const content = [
					'---',
					'tags:',
					'  - 中性标签 🌱',
					'---',
					'',
					'# 中性标题',
					'',
					'正文：中文、English、Emoji 🛠️',
				].join('\n')
				const result = await execVaultBash(
					this.app,
					[`cat > "/${path}" << 'ENDOFFILE'`, content, 'ENDOFFILE'].join('\n'),
				)
				assert(result.exitCode === 0, 'Bash heredoc write failed')
				const bytes = await this.app.vault.adapter.readBinary(path)
				const actual = new TextDecoder().decode(bytes)
				assert(
					actual === `${content}\n`,
					'Bash heredoc write did not preserve UTF-8 content',
				)
				// The MSB guest is disposable; keep the file available for failure
				// diagnostics instead of racing Obsidian's external-file watcher.
			},
		)

		await run(
			'resolves resource data URLs through the real DataAdapter',
			async () => {
				const { resolveResourceDataUrl } =
					await import('~/ai/tools/resource-data-url')
				const path = '.agents/nutstore-sync/e2e/中性 resource 🌱.txt'
				const content = 'neutral resource / 中性资源 🌱'
				await this.app.vault.adapter.write(path, content)
				try {
					const result = await resolveResourceDataUrl(
						this.app,
						`/${path}`,
						'text/plain',
					)
					assert(result, 'Resource data URL was not resolved from the Vault')
					const encoded = result.slice(result.indexOf(',') + 1)
					const bytes = Uint8Array.from(atob(encoded), (character) =>
						character.charCodeAt(0),
					)
					assert(
						new TextDecoder().decode(bytes) === content,
						'Resource data URL did not preserve Unicode content',
					)
				} finally {
					await this.app.vault.adapter.remove(path)
				}
			},
		)

		await run(
			'persists chat sessions through the real DataAdapter',
			async () => {
				const { SessionsFileBackend } =
					await import('~/ai/chat/session/session-files')
				const backend = new SessionsFileBackend(this.app.vault)
				const id = 'session-neutral-🌱'
				await backend.writeSessionFile(id, {
					session: sessionSnapshot(id),
					title: 'neutral session / 中性会话 🌱',
				})
				const payload = await backend.readSessionFile(id)
				assert(payload.session.id === id, 'Session ID did not persist')
				assert(
					payload.title === 'neutral session / 中性会话 🌱',
					'Session title did not persist',
				)
				assert(
					(await backend.listSessionIds()).includes(id),
					'Session file was not listed',
				)
				await backend.deleteSessionFile(id)
				assert(
					!(await backend.listSessionIds()).includes(id),
					'Session file was not deleted',
				)
			},
		)

		await run('reads memory files through the real DataAdapter', async () => {
			const { MEMORY_ROOT, MemoryIndexRepository } =
				await import('~/ai/chat/context/memory-index')
			const path = `${MEMORY_ROOT}/2026/2026-09-01.md`
			await this.app.vault.adapter.mkdir(`${MEMORY_ROOT}/2026`)
			await this.app.vault.adapter.write(
				path,
				'---\nindex: neutral index 中性索引 🌱\n---\n\nneutral body',
			)
			const repository = new MemoryIndexRepository(this.app, {
				now: () => new Date('2026-09-01T12:00:00.000Z'),
			})
			await repository.refresh()
			const delta = repository
				.getDeltas()
				.find((entry) => entry.key === 'memory:2026-09-01')
			assert(delta, 'Memory file was not indexed')
			const content = delta.content as { index: string }
			assert(
				content.index === 'neutral index 中性索引 🌱',
				'Memory frontmatter was not read',
			)
		})

		await run('tolerates a corrupt chat meta file', async () => {
			const { SessionsFileBackend } =
				await import('~/ai/chat/session/session-files')
			const backend = new SessionsFileBackend(this.app.vault)
			const meta = {
				orderedSessionIds: [],
				sessions: {},
			}
			await backend.writeMetaFile(meta)
			assert(
				JSON.stringify(await backend.readMetaFile()) === JSON.stringify(meta),
				'Chat meta file did not round-trip',
			)
			await this.app.vault.adapter.write(
				'.agents/nutstore-sync/chat-meta.json',
				'[[[',
			)
			assert(
				(await backend.readMetaFile()) === null,
				'Corrupt chat meta file was accepted',
			)
		})

		await run(
			'renders sync progress through the loaded production plugin',
			async () => {
				const plugin = getProductionPlugin(this.app)
				const progress = plugin.progressService
				plugin.isSyncing = true
				progress.syncProgress = { total: 0, completed: [], current: null }
				progress.preparationProgress = null
				progress.syncEnd = false
				progress.syncFailed = false
				progress.syncFailedCount = 0

				try {
					progress.showProgressModal()
					const modal = document.querySelector(
						'.modal.nutstore-sync-progress-modal',
					)
					assert(modal, 'Sync progress modal did not open')
					const statusIcon = modal.querySelector(
						'.nutstore-sync-progress__status-icon--syncing',
					)
					assert(statusIcon, 'Sync progress modal did not render syncing state')

					progress.syncEnd = true
					progress.updateModal()
					progress.updateModal.flush?.()

					const completedIcon = modal.querySelector(
						'.nutstore-sync-progress__status-icon--complete',
					)
					assert(
						completedIcon,
						'Sync progress modal did not render complete state',
					)
					const progressLabel = modal.querySelector(
						'.nutstore-sync-progress__bar-label',
					)
					assert(
						progressLabel?.textContent?.includes('100'),
						'Sync progress modal did not show 100% for an empty completed sync',
					)
					const stopButton = modal.querySelector(
						'.nutstore-sync-progress__footer button',
					)
					assert(
						stopButton?.classList.contains('hidden'),
						`Sync progress modal kept its stop control after completion: ${stopButton?.className ?? 'missing'}`,
					)
				} finally {
					progress.closeProgressModal()
					plugin.isSyncing = false
				}
			},
		)

		await this.app.vault.adapter.write(
			OBSIDIAN_E2E_RESULT_PATH,
			JSON.stringify(
				{
					passed: results.every((result) => !result.error),
					results,
				},
				null,
			),
		)
	}
}
