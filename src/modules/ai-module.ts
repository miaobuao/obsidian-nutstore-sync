import type NutstorePlugin from '~/index'
import { createSelectedTextContextItem } from '~/ai/chat/context/user-context'
import { CHATBOX_AI_ICON_ID } from '~/assets/icons/obsidian-nutstore-ai-icon'
import ChatService from '~/services/chat.service'
import CreativeWorkshopService from '~/services/creative-workshop.service'
import CreativeWorkshopView, {
	CREATIVE_WORKSHOP_VIEW_TYPE,
} from '~/views/creative-workshop.view'
import AppView, { APP_VIEW_TYPE } from '~/views/app.view'
import { AppStore } from '~/ai/apps/store'
import { appIconId } from '~/ai/apps/icon'
import type { AppRevision } from '~/ai/apps/domain'
import type { RuntimeHost } from '~/ai/apps/runtime'
import AppRibbonManager from '~/components/AppRibbonManager'
import { guardAppIO } from './guard-io'
import { Modal, TFile } from 'obsidian'
import { createScopedRibbonIcon } from '~/utils/scoped-ribbon-icon'
import McpService from '~/services/mcp.service'
import MemoryService from '~/services/memory.service'
import ModelsPresetService from '~/services/models-preset.service'
import NutstoreLlmGatewayService from '~/services/nutstore-llm-gateway.service'
import AIConflictResolverService from '~/services/ai-conflict-resolver.service'
import ChatboxView, { CHATBOX_VIEW_TYPE } from '~/views/chatbox.view'
import {
	MemoryEditorView,
	MEMORY_EDITOR_VIEW_TYPE,
} from '~/views/memory-editor.view'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import { ModuleLifecycle, type ModuleScope } from './lifecycle'

/** All AI entry points and background resources belong to this lifetime. */
export class AiModule {
	chat!: ChatService
	workshop!: CreativeWorkshopService
	readonly workshopLifecycle = new ModuleLifecycle(
		(scope) => {
			this.workshop = new CreativeWorkshopService(this.plugin, scope, this.apps)
			const open = () => {
				void scope.background(
					() => this.openWorkshop(),
					(error) => logger.error(error),
				)
			}
			const ribbon = createScopedRibbonIcon(
				this.plugin,
				'lightbulb',
				i18n.t('workshop.openCommand'),
				open,
				'creative-workshop',
			)
			ribbon.element.dataset.nutstoreWorkshop = 'true'
			scope.register(ribbon.dispose)
			this.plugin.addCommand({
				id: 'open-creative-workshop',
				name: i18n.t('workshop.openCommand'),
				icon: 'lightbulb',
				checkCallback: (checking) => {
					if (scope.signal.aborted) return false
					if (!checking) open()
					return true
				},
			})
			scope.register(() => this.plugin.removeCommand('open-creative-workshop'))
		},
		async () => {
			for (const leaf of this.plugin.app.workspace.getLeavesOfType(
				CREATIVE_WORKSHOP_VIEW_TYPE,
			))
				leaf.detach()
			await this.workshop?.suspend()
		},
	)
	apps!: AppStore
	mcp!: McpService
	gateway!: NutstoreLlmGatewayService
	memory!: MemoryService
	readonly models: ModelsPresetService
	readonly conflicts: AIConflictResolverService
	readonly lifecycle = new ModuleLifecycle(
		(scope) => this.start(scope),
		() => this.stop(),
	)

	constructor(private readonly plugin: NutstorePlugin) {
		this.models = new ModelsPresetService(plugin)
		this.conflicts = new AIConflictResolverService(plugin)
	}

	/** Host view factories live once; onOpen also gates restored workspace leaves. */
	registerViews() {
		this.plugin.registerView(
			CREATIVE_WORKSHOP_VIEW_TYPE,
			(leaf) => new CreativeWorkshopView(leaf, this.plugin),
		)
		this.plugin.registerView(
			APP_VIEW_TYPE,
			(leaf) => new AppView(leaf, this.plugin),
		)
		this.plugin.registerView(
			CHATBOX_VIEW_TYPE,
			(leaf) => new ChatboxView(leaf, this.plugin),
		)
		this.plugin.registerView(
			MEMORY_EDITOR_VIEW_TYPE,
			(leaf) => new MemoryEditorView(leaf, this.memory),
		)
	}

	private start(scope: ModuleScope) {
		this.memory = new MemoryService(this.plugin, scope)
		this.mcp = new McpService(this.plugin, scope)
		this.gateway = new NutstoreLlmGatewayService(this.plugin, scope)
		this.chat = new ChatService(this.plugin, scope)
		this.apps = new AppStore(
			guardAppIO(this.plugin.app, scope.check, scope.track),
		)
		scope.register(() => {
			void this.workshopLifecycle
				.update(false)
				.catch((error: unknown) => logger.error(error))
		})
		new AppRibbonManager(this.plugin, scope, this.apps)
		this.models.initializeFromLocalSettings()
		this.conflicts.onload()
		scope.register(() => this.conflicts.onunload())
		const icon = createScopedRibbonIcon(
			this.plugin,
			CHATBOX_AI_ICON_ID,
			i18n.t('chatbox.openCommand'),
			() => {
				if (!scope.signal.aborted) void this.openChatbox()
			},
		)
		scope.register(icon.dispose)
		for (const command of [
			{
				id: 'open-chatbox',
				name: i18n.t('chatbox.openCommand'),
				icon: CHATBOX_AI_ICON_ID,
				run: () => this.openChatbox(),
			},
			{
				id: 'open-memory-note',
				name: i18n.t('memory.openCommand'),
				icon: 'brain',
				run: () => this.memory.openNote(),
			},
		]) {
			this.plugin.addCommand({
				...command,
				checkCallback: (checking) => {
					if (scope.signal.aborted) return false
					if (!checking)
						void scope.background(command.run, (error) => logger.error(error))
					return true
				},
			})
			scope.register(() => this.plugin.removeCommand(command.id))
		}
		const workspace = this.plugin.app.workspace
		const menuEvent = workspace.on('editor-menu', (menu, editor, view) => {
			if (!editor.somethingSelected() || scope.signal.aborted) return
			menu.addItem((item) => {
				item
					.setTitle(
						i18n.language.startsWith('zh') ? '坚果云同步' : 'Nutstore Sync',
					)
					.setIcon('cloud')
				item.setSubmenu()
				item.submenu?.addItem((subItem) => {
					subItem
						.setTitle(i18n.t('chatbox.addToContext'))
						.setIcon('message-square-plus')
						.onClick(() => {
							if (scope.signal.aborted) return
							const selection = editor.listSelections()[0]
							const file = (view as { file?: { path: string } }).file
							if (!selection || !file) return
							this.chat.addUserContext(
								createSelectedTextContextItem({
									type: 'selection',
									filePath: file.path,
									range: { from: selection.anchor, to: selection.head },
									selectedText: editor.getSelection(),
								}),
							)
							void this.openChatbox()
						})
				})
			})
		})
		scope.register(() => workspace.offref(menuEvent))
		void scope.background(
			() => this.mcp.reload(),
			(error) => logger.error(error),
		)
		void scope.background(
			() => this.gateway.initializeProviderFromStoredAuth(),
			(error) => logger.error(error),
		)
	}

	private async stop() {
		for (const type of [
			CHATBOX_VIEW_TYPE,
			MEMORY_EDITOR_VIEW_TYPE,
			CREATIVE_WORKSHOP_VIEW_TYPE,
			APP_VIEW_TYPE,
		]) {
			for (const leaf of this.plugin.app.workspace.getLeavesOfType(type))
				leaf.detach()
		}
		this.gateway?.onunload()
		await this.workshopLifecycle.update(false)
		await this.apps?.settle()
		await Promise.all([this.chat?.suspend(), this.mcp?.close()])
	}

	async openChatbox() {
		if (!this.lifecycle.active) return
		const scope = this.lifecycle.scope
		const workspace = this.plugin.app.workspace
		const leaf =
			workspace.getLeavesOfType(CHATBOX_VIEW_TYPE)[0] ||
			workspace.getRightLeaf(false)
		if (!leaf) return
		await leaf.setViewState({ type: CHATBOX_VIEW_TYPE, active: true })
		if (scope.signal.aborted) {
			leaf.detach()
			return
		}
		void workspace.revealLeaf(leaf)
	}

	async openWorkshop() {
		if (!this.workshopLifecycle.active) return
		const scope = this.workshopLifecycle.scope
		const workspace = this.plugin.app.workspace
		const leaf =
			workspace.getLeavesOfType(CREATIVE_WORKSHOP_VIEW_TYPE)[0] ??
			workspace.getLeaf('tab')
		await leaf.setViewState({ type: CREATIVE_WORKSHOP_VIEW_TYPE, active: true })
		if (scope.signal.aborted) {
			leaf.detach()
			return
		}
		void workspace.revealLeaf(leaf)
	}

	appIcon(id: string) {
		return appIconId(id)
	}

	async openApp(id: string) {
		if (!this.lifecycle.active) return
		const scope = this.lifecycle.scope
		await this.apps.read(id)
		scope.check()
		const workspace = this.plugin.app.workspace
		const existing = workspace
			.getLeavesOfType(APP_VIEW_TYPE)
			.find((candidate) => candidate.view.getState().appId === id)
		if (existing) {
			void workspace.revealLeaf(existing)
			return
		}
		const leaf = workspace.getLeaf('tab')
		await leaf.setViewState({
			type: APP_VIEW_TYPE,
			state: { appId: id },
			active: true,
		})
		if (scope.signal.aborted) {
			leaf.detach()
			return
		}
		void workspace.revealLeaf(leaf)
	}

	async runtimeHost(
		revision: AppRevision,
		appId?: string,
		workshop?: CreativeWorkshopService,
	): Promise<RuntimeHost> {
		const scope = this.lifecycle.scope
		const apps = this.apps
		return {
			readKV: async () => {
				scope.check()
				if (!appId && workshop) return workshop.readKV(revision.id)
				if (!appId) throw new Error('App data is unavailable')
				return apps.readKV(appId, revision.id)
			},
			transact: async (changes) => {
				scope.check()
				if (!appId && workshop) return workshop.transact(revision.id, changes)
				if (!appId) throw new Error('App data is unavailable')
				await apps.transact(appId, revision.id, changes)
			},
			openSource: async (ref) => {
				scope.check()
				const evidence = revision.evidence.find(
					(item) => item.source.id === ref,
				)
				if (!evidence) throw new Error('Unknown App source')
				const modal = scope.ownModal(new Modal(this.plugin.app))
				modal.setTitle(evidence.source.titleAtCapture)
				modal.contentEl.createEl('pre', {
					text: evidence.content,
					cls: 'ns-app-evidence',
				})
				const source = evidence.source
				const path = source.currentPath ?? source.pathAtCapture
				const open = modal.contentEl.createEl('button', {
					text: i18n.t('workshop.openSource'),
				})
				open.addEventListener('click', () => {
					void scope.background(
						async () => {
							if (
								!(
									this.plugin.app.vault.getAbstractFileByPath(path) instanceof
									TFile
								)
							)
								throw new Error(i18n.t('workshop.sourceUnavailable'))
							await this.plugin.app.workspace.openLinkText(
								source.locator.kind === 'heading'
									? `${path}#${source.locator.heading}`
									: path,
								'',
								'tab',
							)
							modal.close()
						},
						(error) => logger.error(error),
					)
				})
				modal.open()
			},
			error: (message) => logger.error(message),
		}
	}
}
