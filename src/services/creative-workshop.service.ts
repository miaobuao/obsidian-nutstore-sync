import { parsePartialJson, tool } from 'ai'
import { hash } from 'ohash'
import type NutstorePlugin from '~/index'
import type { ModuleScope } from '~/modules/lifecycle'
import { guardAppIO } from '~/modules/guard-io'
import type { ChatSession } from '~/ai/chat/domain'
import { SessionsFileBackend } from '~/ai/chat/session/session-files'
import {
	appCodeSchema,
	createAppBuildTurn,
	changeKV,
	type AppRevision,
	type AppCode,
	type AppKV,
	type KVChange,
	type SourceRefId,
} from '~/ai/apps/domain'
import { validateRevision, type AppStore } from '~/ai/apps/store'
import { validateAppIcon } from '~/ai/apps/icon'
import { createAppProbes } from '~/ai/apps/probes'
import {
	APP_BUILD_INSTRUCTIONS,
	appBuildMessages,
	projectAppMessages,
} from '~/ai/apps/context'
import { appError } from '~/ai/apps/error'
import {
	getProviderById,
	getModelById,
	resolveInitialSelection,
} from '~/ai/catalog/config'
import { throwIfAborted, isAbortError } from '~/utils/abort'
import createId from '~/utils/create-id'
import i18n from '~/i18n'

export type CandidateValidator = (
	revision: AppRevision,
	kv: AppKV,
	signal: AbortSignal,
) => Promise<void>

/** Build conversations reference Apps; saved App code/data never depend on a conversation file. */
export default class CreativeWorkshopService {
	session?: ChatSession
	revision?: AppRevision
	/** Ephemeral presentation from publish_app input; never executable or persisted. */
	preview?: Pick<AppCode, 'title' | 'html' | 'css' | 'javascript'> & {
		complete: boolean
	}
	error?: string
	unsaved = false
	private readonly listeners = new Set<() => void>()
	private active?: { controller: AbortController; done: Promise<void> }
	private readonly backend: SessionsFileBackend
	private validator?: CandidateValidator
	private queue: Promise<void> = Promise.resolve()
	private saveTimer?: number
	private dataQueue: Promise<void> = Promise.resolve()
	private savingApp?: Promise<string>
	private initialization?: Promise<void>
	private epoch = 0
	constructor(
		private readonly plugin: NutstorePlugin,
		private readonly scope: ModuleScope,
		readonly apps: AppStore,
	) {
		this.backend = new SessionsFileBackend(
			guardAppIO(plugin.app, scope.check, scope.track),
		)
		scope.register(() => {
			this.active?.controller.abort()
			if (this.saveTimer) window.clearTimeout(this.saveTimer)
		})
	}
	get history() {
		return this.session?.workshop
	}
	get running() {
		return !!this.active
	}
	subscribe(listener: () => void) {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private notify() {
		for (const listener of this.listeners) listener()
	}
	setValidator(validator: CandidateValidator) {
		this.validator = validator
		return () => {
			if (this.validator === validator) this.validator = undefined
		}
	}
	async initialize() {
		if (!this.session)
			await (this.initialization ??= this.newApp().finally(() => {
				this.initialization = undefined
			}))
	}
	async newApp() {
		await this.stop()
		await this.savingApp
		await this.flush()
		this.scope.check()
		this.session = await this.plugin.ai.chat.createWorkshopSession()
		this.revision = undefined
		this.error = undefined
		this.epoch++
		this.notify()
	}
	async openSession(id: string) {
		await this.stop()
		await this.savingApp
		await this.flush()
		this.scope.check()
		this.session = await this.plugin.ai.chat.loadWorkshopSession(id)
		this.error = undefined
		this.revision = this.history?.draftRevision
		if (this.history?.appId) {
			try {
				this.revision = (await this.apps.read(this.history.appId)).revision
			} catch {
				this.revision = undefined
				this.error = i18n.t('workshop.missingApp')
			}
		}
		this.epoch++
		this.notify()
	}
	async editApp(id: string) {
		await this.stop()
		await this.savingApp
		await this.flush()
		this.scope.check()
		const saved = await this.apps.read(id)
		const sessions = await this.plugin.ai.chat.listWorkshopSessions()
		let session: ChatSession | undefined
		for (const item of sessions) {
			try {
				const candidate = await this.plugin.ai.chat.loadWorkshopSession(item.id)
				if (candidate.workshop?.appId === id) {
					session = candidate
					break
				}
			} catch {
				/* An unrelated damaged conversation cannot prevent editing an independent App. */
			}
		}
		this.session =
			session ?? (await this.plugin.ai.chat.createWorkshopSession())
		const history = this.history!
		history.appId = id
		// Saved evidence is restored into the build context even if the original conversation was deleted.
		for (const item of saved.revision.evidence) {
			const source = { ...item.source, evidenceArtifactId: hash(item.content) }
			await this.backend.writeArtifact(
				this.session.id,
				source.evidenceArtifactId,
				item.content,
			)
			history.sources[source.id] = source
			history.nextSource = Math.max(
				history.nextSource,
				Number(source.id.slice(1)) + 1,
			)
		}
		this.revision = saved.revision
		this.error = undefined
		this.epoch++
		await this.save()
		this.notify()
	}
	saveApp(): Promise<string> {
		if (this.savingApp) return this.savingApp
		this.scope.check()
		if (this.running || !this.history || !this.revision)
			return Promise.reject(new Error(i18n.t('workshop.noApp')))
		if (this.history.appId) return Promise.resolve(this.history.appId)
		const history = this.history,
			revision = this.revision,
			pendingData = this.dataQueue
		const operation = pendingData
			.catch(() => {})
			.then(async () => {
				this.scope.check()
				const saved = await this.apps.create(revision, history.draftKV)
				this.revision = saved.revision
				history.appId = saved.record.id
				history.draftRevision = undefined
				history.draftKV = {}
				await this.save()
				this.notify()
				return saved.record.id
			})
		this.savingApp = operation.finally(() => {
			this.savingApp = undefined
		})
		return this.savingApp
	}
	async readKV(revisionId: string) {
		this.scope.check()
		if (this.revision?.id !== revisionId || !this.history)
			throw new Error('App instance is no longer active')
		return this.history.appId
			? this.apps.readKV(this.history.appId, revisionId)
			: structuredClone(this.history.draftKV)
	}
	transact(revisionId: string, changes: KVChange[]): Promise<void> {
		const saving = this.savingApp
		const next = this.dataQueue
			.catch(() => {})
			.then(async () => {
				await saving
				this.scope.check()
				if (this.revision?.id !== revisionId || !this.history)
					throw new Error('App instance is no longer active')
				if (this.history.appId)
					await this.apps.transact(this.history.appId, revisionId, changes)
				else {
					const history = this.history
					const previous = history.draftKV
					history.draftKV = changeKV(previous, changes)
					try {
						await this.save()
					} catch (error) {
						history.draftKV = previous
						throw error
					}
				}
			})
		this.dataQueue = next
		return next
	}
	async submit(text: string) {
		this.scope.check()
		if (this.running || !text.trim()) return
		if (text.length > 12000) throw new Error(i18n.t('workshop.inputTooLong'))
		await this.initialize()
		const session = this.session!
		const turn = createAppBuildTurn(text.trim())
		session.workshop!.turns.push(turn)
		session.workshop!.draft = ''
		const controller = new AbortController()
		const abort = () => controller.abort()
		this.scope.signal.addEventListener('abort', abort, { once: true })
		const done = Promise.resolve()
			.then(() => this.build(session, turn, controller))
			.finally(() => {
				this.scope.signal.removeEventListener('abort', abort)
				this.active = undefined
				this.preview = undefined
				this.notify()
			})
		this.active = { controller, done }
		this.error = undefined
		this.notify()
	}
	private async build(
		session: ChatSession,
		turn: ReturnType<typeof createAppBuildTurn>,
		controller: AbortController,
	) {
		const history = session.workshop!
		const before = new Set(
			session.subagents.master.timeline.map((message) => message.id),
		)
		let published = false
		try {
			await this.save()
			throwIfAborted(controller.signal)
			if (!this.validator)
				throw new Error(i18n.t('workshop.openWorkshopRequired'))
			const selection =
				session.model ??
				resolveInitialSelection(
					this.plugin.settings.ai.providers,
					this.plugin.settings.ai.defaultModel,
				)
			if (selection.providerId && selection.modelId)
				session.model = {
					providerId: selection.providerId,
					modelId: selection.modelId,
				}
			const provider = getProviderById(
				this.plugin.settings.ai.providers,
				selection?.providerId,
			)
			const model = getModelById(provider, selection?.modelId)
			if (!provider || !model?.tool_call)
				throw new Error(i18n.t('workshop.modelRequired'))
			await this.plugin.ai.gateway.ensureProviderReady(provider)
			const base = history.appId
				? (await this.apps.read(history.appId)).revision
				: this.revision
			const allowedRefs = new Set(
				Object.values(history.sources).map((source) => source.id),
			)
			const check = () => {
				this.scope.check()
				throwIfAborted(controller.signal)
			}
			let inputText = ''
			let previewAt = 0
			const tools = {
				...createAppProbes({
					app: guardAppIO(this.plugin.app, check, this.scope.track),
					history,
					turn,
					allowedRefs,
					writeArtifact: async (content) => {
						check()
						const id = hash(content)
						await this.backend.writeArtifact(session.id, id, content)
						check()
						return id
					},
					resolvePath: (source) => source.currentPath ?? source.pathAtCapture,
					persist: () => this.save(),
				}),
				publish_app: tool({
					description:
						'Submit a complete App revision with its SVG icon. Validates and runs startup in an isolated preview using disposable data. On failure, fix the reported issue and retry. Publishing updates code while retaining user data.',
					inputSchema: appCodeSchema,
					onInputStart: () => {
						check()
						inputText = ''
						previewAt = 0
						this.preview = {
							title: '',
							html: '',
							css: '',
							javascript: '',
							complete: false,
						}
						this.notify()
					},
					onInputDelta: async ({ inputTextDelta }) => {
						check()
						inputText += inputTextDelta
						if (Date.now() - previewAt < 100) return
						previewAt = Date.now()
						const { value } = await parsePartialJson(inputText)
						check()
						if (!value || typeof value !== 'object' || Array.isArray(value))
							return
						const field = (key: string) =>
							typeof value[key] === 'string' ? value[key] : ''
						this.preview = {
							title: field('title'),
							html: field('html'),
							css: field('css'),
							javascript: field('javascript'),
							complete: false,
						}
						this.notify()
					},
					execute: async (code) => {
						check()
						if (published)
							return { ok: false, error: 'Already published in this turn' }
						this.preview = { ...code, complete: true }
						this.notify()
						try {
							code.iconSvg = validateAppIcon(
								code.iconSvg,
								this.plugin.app.workspace.containerEl.ownerDocument,
							)
							const evidence = await Promise.all(
								code.sourceRefs.map(async (ref) => {
									if (!allowedRefs.has(ref as SourceRefId))
										throw new Error('Invalid App evidence reference')
									const source = history.sources[ref as `s${number}`]
									return {
										source: { ...source },
										content: await this.backend.readArtifact(
											session.id,
											source.evidenceArtifactId,
										),
									}
								}),
							)
							const revision = validateRevision({
								schemaVersion: 1,
								id: createId('app-revision'),
								parentRevisionId: base?.id ?? null,
								createdAt: Date.now(),
								code,
								evidence,
							})
							await this.validator!(
								revision,
								history.appId
									? (await this.apps.read(history.appId)).record.kv
									: history.draftKV,
								controller.signal,
							)
							check()
							if (history.appId) await this.apps.commit(history.appId, revision)
							else history.draftRevision = revision
							this.revision = revision
							this.preview = undefined
							turn.revisionId = revision.id
							published = true
							await this.save()
							this.notify()
							return { ok: true, revisionId: revision.id }
						} catch (error) {
							check()
							return { ok: false, error: appError(error).slice(0, 6000) }
						}
					},
				}),
			}
			const result = await this.plugin.ai.chat.getAppBuildRunner().runTurn({
				session,
				agent: session.subagents.master,
				provider,
				model,
				depth: 0,
				assistantMeta: {},
				isTurnAlive: () =>
					!controller.signal.aborted && !this.scope.signal.aborted,
				taskOrigin: { turnId: turn.id, signal: controller.signal },
				abortSignal: controller.signal,
				buildMessages: async () => appBuildMessages(history, turn, base),
				execution: {
					tools,
					instructions: APP_BUILD_INSTRUCTIONS,
					maxSteps: 12,
					projectMessages: projectAppMessages,
					onProgress: () => this.notify(),
					onStream: async () => {
						this.notify()
					},
				},
			})
			if (result.status !== 'completed' || !published)
				throw new Error(i18n.t('workshop.publishRequired'))
			turn.status = 'completed'
		} catch (error) {
			turn.status =
				controller.signal.aborted || isAbortError(error)
					? 'cancelled'
					: 'failed'
			turn.error = appError(error)
			this.error = turn.status === 'failed' ? turn.error : undefined
		} finally {
			turn.finishedAt = Date.now()
			turn.messageIds = session.subagents.master.timeline
				.filter((message) => !before.has(message.id))
				.map((message) => message.id)
			await this.save().catch((error) => {
				this.error = appError(error)
			})
			this.notify()
		}
	}
	setDraft(text: string) {
		if (!this.history) return
		this.history.draft = text
		if (this.saveTimer) window.clearTimeout(this.saveTimer)
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = undefined
			void this.save().catch(() => this.notify())
		}, 500)
	}
	save() {
		const session = this.session
		if (!session) return Promise.resolve()
		session.updatedAt = Date.now()
		const next = this.queue
			.catch(() => {})
			.then(() => this.plugin.ai.chat.persistWorkshopSession(session))
		this.queue = next
		return next.then(
			() => {
				this.unsaved = false
			},
			(error) => {
				this.unsaved = true
				throw error
			},
		)
	}
	async stop() {
		this.active?.controller.abort()
		await this.active?.done
	}
	async flush() {
		await this.dataQueue.catch(() => {})
		if (this.saveTimer || this.unsaved) {
			window.clearTimeout(this.saveTimer)
			this.saveTimer = undefined
			await this.save()
		}
		await this.queue
	}
	async suspend() {
		await this.stop()
		await this.flush().catch(() => {})
	}
	get instanceEpoch() {
		return this.epoch
	}
}
