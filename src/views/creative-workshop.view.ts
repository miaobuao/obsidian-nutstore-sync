import {
	Component,
	ItemView,
	MarkdownRenderer,
	Menu,
	Modal,
	Notice,
	setIcon,
	type WorkspaceLeaf,
} from 'obsidian'
import type NutstorePlugin from '~/index'
import type CreativeWorkshopService from '~/services/creative-workshop.service'
import { AppRuntime } from '~/ai/apps/runtime'
import { changeKV, type AppRevision, type AppKV } from '~/ai/apps/domain'
import { appError } from '~/ai/apps/error'
import { raceWithAbort } from '~/utils/abortable'
import i18n from '~/i18n'
import { buildWorkshopTimeline } from '~/ai/apps/timeline'
import { mountWorkshopTimeline } from '~/components/solid-js/Chatbox/WorkshopTimeline'
import { toolCallDisplayTitle } from '~/components/solid-js/Chatbox/utils'
import type { ChatboxProps } from '~/ai/chat/ui/types'

export const CREATIVE_WORKSHOP_VIEW_TYPE = 'nutstore-creative-workshop'

/** The workshop owns creation controls. Every generated App uses the same sandbox runtime. */
export default class CreativeWorkshopView extends ItemView {
	private service!: CreativeWorkshopService
	private host!: HTMLElement
	private output!: HTMLElement
	private surface!: HTMLElement
	private previewSurface!: HTMLElement
	private feedback!: HTMLElement
	private composerPanel!: HTMLElement
	private timelineDisclosure!: HTMLDetailsElement
	private timelineSummary!: HTMLElement
	private timelineController?: ReturnType<typeof mountWorkshopTimeline>
	private previewRuntime?: AppRuntime
	private composerAnimation?: Animation
	private composer!: HTMLTextAreaElement
	private status!: HTMLElement
	private timeline!: HTMLElement
	private saveButton!: HTMLButtonElement
	private openButton!: HTMLButtonElement
	private sendButton!: HTMLButtonElement
	private stopButton!: HTMLButtonElement
	private runtime?: AppRuntime
	private signature = ''
	private closed = true
	private disposers: Array<() => void> = []
	private renderEpoch = 0
	private lastSessionId?: string
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: NutstorePlugin,
	) {
		super(leaf)
	}
	getViewType() {
		return CREATIVE_WORKSHOP_VIEW_TYPE
	}
	getDisplayText() {
		return i18n.t('workshop.title')
	}
	getIcon() {
		return 'lightbulb'
	}
	async onOpen() {
		if (!this.plugin.ai.workshopLifecycle.active) {
			this.leaf.detach()
			return
		}
		this.closed = false
		this.service = this.plugin.ai.workshop
		this.build()
		this.bindViewport()
		this.disposers.push(this.service.subscribe(() => this.refresh()))
		this.disposers.push(
			this.service.setValidator((revision, kv, signal) =>
				this.validateCandidate(revision, kv, signal),
			),
		)
		await this.service.initialize()
		this.refresh()
		this.registerInterval(
			this.contentEl.ownerDocument.defaultView!.setInterval(() => {
				if (this.service.running) this.refresh()
			}, 1000),
		)
	}
	private button(
		parent: HTMLElement,
		label: string,
		icon: string,
		action: () => void | Promise<unknown>,
		showLabel = false,
	) {
		const el = parent.createEl('button', {
			cls: 'ns-workshop-button',
			attr: { title: label, 'aria-label': label, type: 'button' },
		})
		setIcon(el, icon)
		if (showLabel) el.createSpan({ text: label })
		this.registerDomEvent(el, 'click', () => this.perform(action))
		return el
	}
	/** The visual viewport shrinks with the keyboard even when the workspace does not. */
	private bindViewport() {
		const viewport = this.contentEl.ownerDocument.defaultView?.visualViewport
		if (!viewport) return
		const win = this.contentEl.ownerDocument.defaultView!
		let focusFrame: number | undefined
		const update = () => {
			const top = this.host.getBoundingClientRect().top
			this.host.style.setProperty(
				'--ns-workshop-viewport-height',
				`${Math.max(0, viewport.height - Math.max(0, top - viewport.offsetTop))}px`,
			)
			if (this.contentEl.ownerDocument.activeElement === this.composer) {
				if (focusFrame !== undefined) win.cancelAnimationFrame(focusFrame)
				focusFrame = win.requestAnimationFrame(() => {
					focusFrame = undefined
					this.composer.parentElement?.scrollIntoView({
						block: 'nearest',
						inline: 'nearest',
					})
				})
			}
		}
		viewport.addEventListener('resize', update)
		viewport.addEventListener('scroll', update)
		const observer = new ResizeObserver(update)
		observer.observe(this.contentEl)
		this.disposers.push(() => {
			viewport.removeEventListener('resize', update)
			viewport.removeEventListener('scroll', update)
			observer.disconnect()
			if (focusFrame !== undefined) win.cancelAnimationFrame(focusFrame)
		})
		update()
	}
	private perform(action: () => void | Promise<unknown>) {
		void Promise.resolve()
			.then(action)
			.catch((error) => {
				if (!this.closed) new Notice(appError(error))
			})
	}
	private build() {
		this.contentEl.empty()
		this.contentEl.addClass('ns-workshop-container')
		this.host = this.contentEl.createDiv({ cls: 'ns-workshop-view is-home' })
		const top = this.host.createDiv({ cls: 'ns-workshop-top' })
		top.createSpan({
			text: i18n.t('workshop.title'),
			cls: 'ns-workshop-heading',
		})
		this.button(top, i18n.t('workshop.newApp'), 'plus', () =>
			this.service.newApp(),
		)
		this.button(top, i18n.t('workshop.library'), 'library', () =>
			this.showLibrary(),
		)
		this.saveButton = this.button(top, i18n.t('workshop.saveApp'), 'save', () =>
			this.service.saveApp(),
		)
		this.openButton = this.button(
			top,
			i18n.t('workshop.openApp'),
			'play',
			async () => {
				const id = this.service.history?.appId ?? (await this.service.saveApp())
				await this.plugin.ai.openApp(id)
			},
		)
		const more = this.button(top, i18n.t('workshop.more'), 'ellipsis', () => {
			const menu = new Menu()
			const add = (
				label: string,
				icon: string,
				action: () => void | Promise<unknown>,
				disabled = false,
			) =>
				menu.addItem((item) =>
					item
						.setTitle(label)
						.setIcon(icon)
						.setDisabled(disabled)
						.onClick(() => this.perform(action)),
				)
			add(
				i18n.t('workshop.pin'),
				'pin',
				async () => {
					const id =
						this.service.history?.appId ?? (await this.service.saveApp())
					const saved = await this.service.apps.read(id)
					await this.service.apps.setPinned(id, !saved.record.pinned)
					new Notice(
						i18n.t(
							saved.record.pinned ? 'workshop.unpinned' : 'workshop.pinned',
						),
					)
				},
				!this.service.revision || this.service.running,
			)
			add(
				i18n.t('workshop.retrySave'),
				'refresh-cw',
				() => this.service.save(),
				!this.service.unsaved,
			)
			add(i18n.t('workshop.archive'), 'messages-square', () => {
				const modal = this.plugin.ai.workshopLifecycle.scope.ownModal(
					new Modal(this.app),
				)
				modal.setTitle(i18n.t('workshop.archive'))
				if (this.service.session?.legacySearch) {
					modal.contentEl.createEl('p', {
						text: i18n.t('workshop.legacyArchive'),
					})
					modal.contentEl.createEl('pre', {
						text: JSON.stringify(this.service.session.legacySearch, null, 2),
						cls: 'ns-app-evidence',
					})
				}
				modal.contentEl.createEl('pre', {
					text: JSON.stringify(
						this.service.session?.subagents.master.timeline,
						null,
						2,
					),
					cls: 'ns-app-evidence',
				})
				modal.open()
			})
			const bounds = more.getBoundingClientRect()
			menu.showAtPosition(
				{ x: bounds.left, y: bounds.bottom },
				this.contentEl.ownerDocument,
			)
		})
		const stage = this.host.createDiv({ cls: 'ns-workshop-stage' })
		this.output = stage.createDiv({ cls: 'ns-workshop-output' })
		this.surface = this.output.createDiv({ cls: 'ns-workshop-surface' })
		this.previewSurface = this.output.createDiv({
			cls: 'ns-workshop-preview',
			attr: { 'aria-label': i18n.t('workshop.livePreview') },
		})
		this.feedback = this.output.createDiv({
			cls: 'ns-workshop-feedback',
			attr: { role: 'status' },
		})
		const composer = (this.composerPanel = stage.createDiv({
			cls: 'ns-workshop-composer',
		}))
		const intro = composer.createDiv({ cls: 'ns-workshop-intro' })
		intro.createEl('h1', { text: i18n.t('workshop.title') })
		intro.createEl('p', { text: i18n.t('workshop.subtitle') })
		const examples = intro.createDiv({ cls: 'ns-workshop-examples' })
		for (const key of [
			'gameExample',
			'trackerExample',
			'notesExample',
		] as const) {
			const button = examples.createEl('button', {
				text: i18n.t(`workshop.${key}`),
			})
			this.registerDomEvent(button, 'click', () => {
				this.composer.value = button.textContent ?? ''
				this.service.setDraft(this.composer.value)
				this.composer.focus()
			})
		}
		const input = composer.createDiv({ cls: 'ns-workshop-input' })
		this.composer = input.createEl('textarea', {
			attr: {
				placeholder: i18n.t('workshop.placeholder'),
				'aria-label': i18n.t('workshop.placeholder'),
				rows: '3',
			},
		})
		this.registerDomEvent(this.composer, 'input', () =>
			this.service.setDraft(this.composer.value),
		)
		this.registerDomEvent(this.composer, 'keydown', (event) => {
			if (
				event.key === 'Enter' &&
				(event.ctrlKey || event.metaKey) &&
				!event.isComposing
			) {
				event.preventDefault()
				this.send()
			}
		})
		const actions = input.createDiv({ cls: 'ns-workshop-input-actions' })
		this.stopButton = this.button(
			actions,
			i18n.t('workshop.stop'),
			'square',
			() => this.service.stop(),
			true,
		)
		this.sendButton = this.button(
			actions,
			i18n.t('workshop.create'),
			'arrow-up',
			() => this.send(),
			true,
		)
		this.sendButton.addClass('mod-cta')
		this.status = composer.createDiv({
			cls: 'ns-workshop-status',
			attr: { role: 'status' },
		})
		this.timelineDisclosure = composer.createEl('details', {
			cls: 'ns-workshop-timeline',
		})
		const summary = this.timelineDisclosure.createEl('summary')
		summary.createSpan({
			cls: 'ns-workshop-progress-dot',
			attr: { 'aria-hidden': 'true' },
		})
		this.timelineSummary = summary.createSpan({
			cls: 'ns-workshop-timeline-summary',
		})
		setIcon(
			summary.createSpan({
				cls: 'ns-workshop-timeline-chevron',
				attr: { 'aria-hidden': 'true' },
			}),
			'chevron-up',
		)
		composer.insertBefore(this.timelineDisclosure, input)
		this.timeline = this.timelineDisclosure.createDiv({
			cls: 'ns-workshop-timeline-content',
		})
	}
	private send() {
		if (this.service.running) return
		const text = this.composer.value
		this.perform(async () => {
			await this.service.submit(text)
			if (text.trim()) this.composer.value = ''
		})
	}
	private refresh() {
		if (this.closed || !this.service.session) return
		const session = this.service.session
		if (session.id !== this.lastSessionId) {
			this.lastSessionId = session.id
			this.composer.value = this.service.history?.draft ?? ''
			this.timelineDisclosure.open = false
			this.previewRuntime?.destroy()
			this.previewRuntime = undefined
		}
		const revision = this.service.revision
		const home = !revision && !this.service.history?.turns.length
		const wasHome = this.host.classList.contains('is-home')
		const before = this.composerPanel.getBoundingClientRect()
		this.host.classList.toggle('is-home', home)
		this.host.classList.toggle('is-building', this.service.running)
		this.saveButton.disabled =
			!revision || this.service.running || !!this.service.history?.appId
		this.saveButton.hidden = !revision || !!this.service.history?.appId
		this.openButton.hidden = !revision
		this.openButton.disabled = !revision || this.service.running
		this.sendButton.hidden = this.service.running
		this.stopButton.hidden = !this.service.running
		this.status.textContent =
			this.service.error ??
			(this.service.unsaved
				? i18n.t('workshop.unsaved')
				: this.service.running
					? this.progressLabel()
					: this.service.history?.appId
						? i18n.t('workshop.saved')
						: revision
							? i18n.t('workshop.draftApp')
							: '')
		this.status.classList.toggle('ns-workshop-error', !!this.service.error)
		this.renderTimeline()
		this.renderPreview()
		if (
			wasHome &&
			!home &&
			!this.contentEl.ownerDocument.defaultView!.matchMedia(
				'(prefers-reduced-motion: reduce)',
			).matches
		) {
			const after = this.composerPanel.getBoundingClientRect()
			this.composerAnimation?.cancel()
			this.composerAnimation = this.composerPanel.animate(
				[
					{ transform: `translateY(${before.top - after.top}px)` },
					{ transform: 'translateY(0)' },
				],
				{ duration: 460, easing: 'cubic-bezier(.22, 1, .36, 1)' },
			)
		} else if (home) this.composerAnimation?.cancel()
		const signature = `${session.id}:${this.service.history?.appId ?? 'draft'}:${revision?.id ?? ''}:${this.service.instanceEpoch}`
		if (signature === this.signature) return
		this.signature = signature
		this.runtime?.destroy()
		this.runtime = undefined
		this.surface.empty()
		const epoch = ++this.renderEpoch
		if (!revision) return
		void this.mount(revision, epoch)
	}
	private async mount(revision: AppRevision, epoch: number) {
		try {
			const host = await this.plugin.ai.runtimeHost(
				revision,
				this.service.history?.appId,
				this.service,
			)
			if (this.closed || epoch !== this.renderEpoch) return
			this.runtime = new AppRuntime(this.surface, revision, {
				...host,
				error: (message) => {
					this.status.textContent = message
					this.status.classList.add('ns-workshop-error')
				},
			})
			await this.runtime.ready
		} catch (error) {
			if (!this.closed && epoch === this.renderEpoch) {
				this.status.textContent = appError(error)
				this.status.classList.add('ns-workshop-error')
			}
		}
	}
	private async validateCandidate(
		revision: AppRevision,
		kv: AppKV,
		signal: AbortSignal,
	) {
		const container = this.host.createDiv({
			cls: 'ns-workshop-candidate',
			attr: { 'aria-hidden': 'true' },
		})
		// Validate startup at the visible preview size, including narrow mobile leaves.
		const bounds = this.output.getBoundingClientRect()
		container.style.width = `${Math.max(1, bounds.width)}px`
		container.style.height = `${Math.max(1, bounds.height)}px`
		let disposable = structuredClone(kv)
		const runtime = new AppRuntime(container, revision, {
			readKV: async () => disposable,
			transact: async (changes) => {
				disposable = changeKV(disposable, changes)
			},
			openSource: async () => {
				throw new Error('Source navigation is available after publication')
			},
			error: () => {},
		})
		const dispose = () => runtime.destroy()
		signal.addEventListener('abort', dispose, { once: true })
		try {
			await raceWithAbort(runtime.ready, signal)
		} finally {
			signal.removeEventListener('abort', dispose)
			runtime.destroy()
			container.remove()
		}
	}
	private readonly renderMarkdown: NonNullable<ChatboxProps['renderMarkdown']> =
		async (el, markdown) => {
			const component = new Component()
			this.addChild(component)
			try {
				await MarkdownRenderer.render(this.app, markdown, el, '', component)
			} catch {
				el.textContent = markdown
			}
			return () => this.removeChild(component)
		}
	private progressLabel() {
		const preview = this.service.preview
		if (preview)
			return i18n.t(
				preview.complete
					? 'workshop.validating'
					: preview.javascript
						? 'workshop.addingBehavior'
						: preview.css
							? 'workshop.styling'
							: preview.html
								? 'workshop.drawingLayout'
								: 'workshop.building',
			)
		const turn = this.service.history?.turns.at(-1)
		if (turn?.revisionId) return i18n.t('workshop.appReady')
		const timeline = buildWorkshopTimeline(this.service.session!)
		const latest = timeline.at(-1)
		const calls = latest?.displayBlocks.filter(
			(block) => block.kind === 'tool-call',
		)
		if (calls?.length)
			return (
				calls
					.map((block) => toolCallDisplayTitle(block.toolCall))
					.filter(Boolean)
					.join(', ') || i18n.t('workshop.building')
			)
		const text =
			latest?.message.role === 'assistant'
				? latest.displayBlocks
						.flatMap((block) =>
							block.kind === 'content'
								? block.parts.flatMap((part) =>
										part.type === 'text' ? [part.text] : [],
									)
								: [],
						)
						.join(' ')
				: ''
		return text.trim() || i18n.t('workshop.building')
	}
	private renderTimeline() {
		const session = this.service.session!
		const turn = this.service.history?.turns.at(-1)
		this.timelineDisclosure.hidden = !turn
		const elapsed =
			turn && this.service.running
				? ` · ${Math.floor((Date.now() - turn.createdAt) / 1000)}s`
				: ''
		this.timelineSummary.textContent = `${i18n.t('workshop.conversations')} · ${this.service.running ? this.progressLabel() : turn ? i18n.t(`workshop.${turn.status}`) : ''}${elapsed}`
		const props = {
			timeline: buildWorkshopTimeline(session),
			sessionId: session.id,
			runState: this.service.running
				? ('thinking' as const)
				: ('idle' as const),
			now: Date.now(),
			renderMarkdown: this.renderMarkdown,
		}
		if (this.timelineController) this.timelineController.update(props)
		else this.timelineController = mountWorkshopTimeline(this.timeline, props)
	}
	private renderPreview() {
		const preview = this.service.preview
		const visible = !!preview?.html.trim()
		this.previewSurface.hidden = !visible
		this.surface.hidden = visible
		this.feedback.hidden = visible || !!this.service.revision
		this.feedback.textContent =
			this.service.error ??
			(this.service.running
				? this.progressLabel()
				: i18n.t('workshop.previewWaiting'))
		if (!visible || !preview) {
			this.previewRuntime?.destroy()
			this.previewRuntime = undefined
			return
		}
		if (!this.previewRuntime) {
			// The streamed page is presentation-only and shares the final App's sandbox/sanitizer.
			const revision: AppRevision = {
				schemaVersion: 1,
				id: 'stream-preview',
				parentRevisionId: null,
				createdAt: Date.now(),
				evidence: [],
				code: {
					title: preview.title || i18n.t('workshop.livePreview'),
					iconSvg: '',
					html: preview.html,
					css: preview.css,
					javascript: '',
					dataVersion: 1,
					assets: [],
					sourceRefs: [],
				},
			}
			const runtime = (this.previewRuntime = new AppRuntime(
				this.previewSurface,
				revision,
				{
					readKV: async () => ({}),
					transact: async () => {},
					openSource: async () => {},
					error: () => {},
				},
			))
			void runtime.ready
				.then(() => {
					if (this.previewRuntime === runtime && this.service.preview)
						runtime.updatePresentation(
							this.service.preview.html,
							this.service.preview.css,
						)
				})
				.catch(() => {})
		} else this.previewRuntime.updatePresentation(preview.html, preview.css)
	}
	private async showLibrary() {
		const modal = this.plugin.ai.workshopLifecycle.scope.ownModal(
			new Modal(this.app),
		)
		modal.setTitle(i18n.t('workshop.library'))
		modal.contentEl.addClass('ns-app-library')
		const apps = await this.service.apps.list()
		for (const item of apps) {
			const row = modal.contentEl.createDiv({ cls: 'ns-app-library-row' })
			if (!item.app) {
				row.createEl('p', { text: `${item.id}: ${item.error}` })
				continue
			}
			const saved = item.app
			setIcon(
				row.createSpan({ cls: 'ns-app-library-icon' }),
				this.plugin.ai.appIcon(item.id),
			)
			row.createSpan({
				text: saved.revision.code.title,
				cls: 'ns-app-library-title',
			})
			const actions = row.createDiv({ cls: 'ns-app-library-actions' })
			this.button(
				actions,
				i18n.t('workshop.openApp'),
				'play',
				async () => {
					await this.plugin.ai.openApp(item.id)
					modal.close()
				},
				true,
			)
			this.button(
				actions,
				i18n.t('workshop.modify'),
				'pencil',
				async () => {
					await this.service.editApp(item.id)
					modal.close()
				},
				true,
			)
			this.button(
				actions,
				i18n.t(saved.record.pinned ? 'workshop.unpin' : 'workshop.pin'),
				saved.record.pinned ? 'pin-off' : 'pin',
				async () => {
					await this.service.apps.setPinned(item.id, !saved.record.pinned)
					modal.close()
				},
			)
			this.button(actions, i18n.t('workshop.deleteApp'), 'trash-2', () => {
				const confirm = row.createDiv({ cls: 'ns-app-library-confirm' })
				confirm.createSpan({ text: i18n.t('workshop.deleteAppPrompt') })
				this.button(
					confirm,
					i18n.t('workshop.deleteApp'),
					'check',
					async () => {
						await this.service.apps.remove(item.id)
						if (this.service.history?.appId === item.id)
							await this.service.newApp()
						modal.close()
					},
				)
				this.button(confirm, i18n.t('workshop.cancel'), 'x', () =>
					confirm.remove(),
				)
			})
		}
		if (!apps.length)
			modal.contentEl.createEl('p', { text: i18n.t('workshop.libraryEmpty') })
		modal.contentEl.createEl('h3', { text: i18n.t('workshop.conversations') })
		const sessions = await this.plugin.ai.chat.listWorkshopSessions()
		for (const session of sessions) {
			const row = modal.contentEl.createDiv({ cls: 'ns-app-library-row' })
			row.createSpan({ text: session.title, cls: 'ns-app-library-title' })
			const actions = row.createDiv({ cls: 'ns-app-library-actions' })
			this.button(
				actions,
				i18n.t('workshop.resume'),
				'messages-square',
				async () => {
					await this.service.openSession(session.id)
					modal.close()
				},
				true,
			)
			this.button(
				actions,
				i18n.t('workshop.deleteConversation'),
				'trash-2',
				() => {
					const confirm = row.createDiv({ cls: 'ns-app-library-confirm' })
					confirm.createSpan({
						text: i18n.t('workshop.deleteConversationPrompt'),
					})
					this.button(
						confirm,
						i18n.t('workshop.deleteConversation'),
						'check',
						async () => {
							if (session.id === this.service.session?.id)
								await this.service.newApp()
							await this.plugin.ai.chat.deleteSession(session.id)
							row.remove()
						},
					)
					this.button(confirm, i18n.t('workshop.cancel'), 'x', () =>
						confirm.remove(),
					)
				},
			)
		}
		modal.open()
	}
	async onClose() {
		this.closed = true
		this.renderEpoch++
		this.runtime?.destroy()
		this.previewRuntime?.destroy()
		this.timelineController?.destroy()
		this.timelineController = undefined
		this.composerAnimation?.cancel()
		for (const dispose of this.disposers.splice(0)) dispose()
		await this.service?.stop()
		await this.service?.flush().catch(() => {})
		this.contentEl.empty()
		this.contentEl.addClass('ns-workshop-container')
	}
}
