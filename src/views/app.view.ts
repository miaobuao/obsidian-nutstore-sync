import {
	ItemView,
	Notice,
	setIcon,
	type WorkspaceLeaf,
	type ViewStateResult,
} from 'obsidian'
import type NutstorePlugin from '~/index'
import { AppRuntime } from '~/ai/apps/runtime'
import { appError } from '~/ai/apps/error'
import i18n from '~/i18n'

export const APP_VIEW_TYPE = 'nutstore-app'

/** Saved Apps open independently of the workshop, and persist only their stable App identity in the workspace. */
export default class AppView extends ItemView {
	private appId?: string
	private title?: string
	private runtime?: AppRuntime
	private unsubscribe?: () => void
	private closed = true
	private revisionId?: string
	private epoch = 0
	private pinButton?: HTMLButtonElement
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: NutstorePlugin,
	) {
		super(leaf)
	}
	getViewType() {
		return APP_VIEW_TYPE
	}
	getDisplayText() {
		return this.title ?? i18n.t('workshop.openApp')
	}
	getIcon() {
		return this.appId ? this.plugin.ai.appIcon(this.appId) : 'app-window'
	}
	getState() {
		return { appId: this.appId }
	}
	async setState(state: unknown, result: ViewStateResult) {
		const id =
			state && typeof state === 'object'
				? (Reflect.get(state, 'appId') as unknown)
				: undefined
		this.appId = typeof id === 'string' ? id : undefined
		this.revisionId = undefined
		await super.setState(state, result)
		if (!this.closed) await this.refresh()
	}
	async onOpen() {
		if (!this.plugin.ai.lifecycle.active) {
			this.leaf.detach()
			return
		}
		this.closed = false
		this.unsubscribe = this.plugin.ai.apps.subscribe(() => {
			void this.refresh()
		})
		await this.refresh()
	}
	private async refresh() {
		if (this.closed || !this.appId) return
		const epoch = ++this.epoch
		try {
			const saved = await this.plugin.ai.apps.read(this.appId)
			if (this.closed || epoch !== this.epoch) return
			this.title = saved.revision.code.title
			if (this.pinButton) {
				const label = i18n.t(
					saved.record.pinned ? 'workshop.unpin' : 'workshop.pin',
				)
				this.pinButton.setAttribute('title', label)
				this.pinButton.setAttribute('aria-label', label)
				setIcon(this.pinButton, saved.record.pinned ? 'pin-off' : 'pin')
			}
			if (saved.revision.id === this.revisionId) return
			this.runtime?.destroy()
			this.contentEl.empty()
			this.contentEl.addClass('ns-app-view')
			const toolbar = this.contentEl.createDiv({ cls: 'ns-workshop-top' })
			toolbar.createSpan({ text: this.title, cls: 'ns-workshop-heading' })
			const action = (
				label: string,
				icon: string,
				run: () => Promise<unknown>,
			) => {
				const button = toolbar.createEl('button', {
					cls: 'ns-workshop-button',
					attr: { title: label, 'aria-label': label },
				})
				setIcon(button, icon)
				this.registerDomEvent(button, 'click', () => {
					void run().catch((error) => new Notice(appError(error)))
				})
				return button
			}
			action(i18n.t('workshop.modify'), 'pencil', async () => {
				await this.plugin.ai.openWorkshop()
				await this.plugin.ai.workshop.editApp(this.appId!)
			})
			this.pinButton = action(
				i18n.t(saved.record.pinned ? 'workshop.unpin' : 'workshop.pin'),
				saved.record.pinned ? 'pin-off' : 'pin',
				async () => {
					const current = await this.plugin.ai.apps.read(this.appId!)
					await this.plugin.ai.apps.setPinned(
						this.appId!,
						!current.record.pinned,
					)
				},
			)
			action(i18n.t('workshop.versions'), 'history', async () => {
				const current = await this.plugin.ai.apps.read(this.appId!)
				const { Menu } = await import('obsidian')
				const menu = new Menu()
				for (const id of current.record.revisionIds.slice().reverse()) {
					const revision = await this.plugin.ai.apps.readRevision(
						this.appId!,
						id,
					)
					menu.addItem((item) =>
						item
							.setTitle(
								`${revision.code.title} · ${new Date(revision.createdAt).toLocaleString()}`,
							)
							.setChecked(id === current.record.currentRevisionId)
							.onClick(() => {
								void this.plugin.ai.apps
									.restore(this.appId!, id)
									.catch((error) => new Notice(appError(error)))
							}),
					)
				}
				menu.showAtPosition({
					x: toolbar.getBoundingClientRect().left,
					y: toolbar.getBoundingClientRect().bottom,
				})
			})
			const status = this.contentEl.createDiv({
				cls: 'ns-workshop-status',
				attr: { role: 'status' },
			})
			const output = this.contentEl.createDiv({ cls: 'ns-app-output' })
			const host = await this.plugin.ai.runtimeHost(saved.revision, this.appId)
			if (this.closed || epoch !== this.epoch) return
			this.revisionId = saved.revision.id
			this.runtime = new AppRuntime(output, saved.revision, {
				...host,
				error: (message) => {
					status.textContent = message
					status.classList.add('ns-workshop-error')
				},
			})
			await this.runtime.ready
		} catch (error) {
			if (!this.closed && epoch === this.epoch) {
				this.runtime?.destroy()
				this.revisionId = undefined
				this.contentEl.empty()
				this.contentEl.createEl('p', {
					text: appError(error),
					cls: 'ns-workshop-error',
				})
			}
		}
	}
	async onClose() {
		this.closed = true
		this.epoch++
		this.runtime?.destroy()
		this.unsubscribe?.()
		this.contentEl.empty()
	}
}
