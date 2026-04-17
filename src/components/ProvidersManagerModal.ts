import { Modal, Notice, Setting } from 'obsidian'
import { createProviderDraft } from '~/ai/config'
import { AIProviderConfig } from '~/ai/types'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'
import ProviderEditorModal from './ProviderEditorModal'

export default class ProvidersManagerModal extends Modal {
	constructor(
		private plugin: NutstorePlugin,
		private onChanged: () => Promise<void> | void,
	) {
		super(plugin.app)
	}

	onOpen() {
		this.render()
	}

	private render() {
		const { contentEl } = this
		contentEl.empty()
		contentEl.createEl('h2', {
			text: i18n.t('settings.ai.modals.providers.title'),
		})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.providers.name'))
			.setDesc(i18n.t('settings.ai.providers.desc'))
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.providers.add'))
					.setCta()
					.onClick(() => {
						new ProviderEditorModal(
							this.plugin,
							createProviderDraft(),
							async (provider) => {
								this.plugin.settings.ai.providers = [
									...this.plugin.settings.ai.providers,
									provider,
								]
								await this.onChanged()
								this.render()
							},
							true,
						).open()
					}),
			)

		if (this.plugin.settings.ai.providers.length === 0) {
			contentEl.createDiv({
				cls: 'setting-item-description',
				text: i18n.t('settings.ai.providers.empty'),
			})
			return
		}

		for (const provider of this.plugin.settings.ai.providers) {
			new Setting(contentEl)
				.setName(provider.name || i18n.t('settings.ai.unnamedProvider'))
				.setDesc(
					provider.type === 'openai-chat'
						? provider.baseUrl || i18n.t('settings.ai.providers.openaiDefault')
						: i18n.t('settings.ai.providers.noBaseUrl'),
				)
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.ai.modals.provider.edit'))
						.onClick(() => {
							new ProviderEditorModal(
								this.plugin,
								provider,
								async (savedProvider) => {
									this.plugin.settings.ai.providers =
										this.plugin.settings.ai.providers.map((item) =>
											item.id === savedProvider.id ? savedProvider : item,
										)
									await this.onChanged()
									this.render()
								},
								false,
							).open()
						}),
				)
				.addExtraButton((button) => {
					let confirmDelete = false
					button
						.setIcon('trash')
						.setTooltip(i18n.t('settings.ai.providers.delete'))
						.onClick(async () => {
							if (!confirmDelete) {
								confirmDelete = true
								button.setIcon('alert-triangle')
								button.setTooltip(i18n.t('settings.ai.modals.confirmDelete'))
								return
							}
							await this.deleteProvider(provider)
						})
					button.extraSettingsEl.addEventListener('blur', () => {
						confirmDelete = false
						button.setIcon('trash')
						button.setTooltip(i18n.t('settings.ai.providers.delete'))
					})
				})
		}
	}

	private async deleteProvider(provider: AIProviderConfig) {
		try {
			this.plugin.settings.ai.providers =
				this.plugin.settings.ai.providers.filter(
					(item) => item.id !== provider.id,
				)
			await this.onChanged()
			new Notice(i18n.t('settings.ai.modals.provider.deleted'))
			this.render()
		} catch (error) {
			logger.error(error)
			new Notice(i18n.t('settings.ai.errors.saveFailed'))
		}
	}

	onClose() {
		this.contentEl.empty()
	}
}
