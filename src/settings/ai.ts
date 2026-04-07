import { Notice, Setting } from 'obsidian'
import {
	getModelById,
	getProviderById,
	sanitizeDefaultSelections,
	sanitizeProviders,
} from '~/ai/config'
import ProvidersManagerModal from '~/components/ProvidersManagerModal'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import BaseSettings from './settings.base'

export default class AISettings extends BaseSettings {
	async display() {
		this.containerEl.empty()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.sections.ai'))
			.setHeading()

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.defaultProvider.name'))
			.setDesc(i18n.t('settings.ai.defaultProvider.desc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('', i18n.t('settings.ai.none'))
				for (const provider of this.plugin.settings.providers) {
					dropdown.addOption(provider.id, provider.name || i18n.t('settings.ai.unnamedProvider'))
				}
				dropdown
					.setValue(this.plugin.settings.defaultProviderId || '')
					.onChange(async (value) => {
						this.plugin.settings.defaultProviderId = value || undefined
						const provider = getProviderById(this.plugin.settings.providers, value)
						if (!getModelById(provider, this.plugin.settings.defaultModelId)) {
							this.plugin.settings.defaultModelId = undefined
						}
						await this.persist()
						this.display()
					})
			})

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.defaultModel.name'))
			.setDesc(i18n.t('settings.ai.defaultModel.desc'))
			.addDropdown((dropdown) => {
				const provider = getProviderById(
					this.plugin.settings.providers,
					this.plugin.settings.defaultProviderId,
				)
				dropdown.addOption('', i18n.t('settings.ai.none'))
				for (const model of provider?.models || []) {
					dropdown.addOption(model.id, model.name || i18n.t('settings.ai.unnamedModel'))
				}
				dropdown
					.setValue(this.plugin.settings.defaultModelId || '')
					.setDisabled(!provider)
					.onChange(async (value) => {
						this.plugin.settings.defaultModelId = value || undefined
						await this.persist()
					})
			})

		new Setting(this.containerEl)
			.setName(i18n.t('settings.ai.providers.name'))
			.setDesc(
				i18n.t('settings.ai.providers.summary', {
					count: this.plugin.settings.providers.length,
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.ai.providers.manage'))
					.setCta()
					.onClick(() => {
						new ProvidersManagerModal(this.plugin, async () => {
							await this.persist(false)
							this.display()
						}).open()
					}),
			)
	}

	private async persist(showNotice: boolean = true) {
		try {
			this.plugin.settings.providers = sanitizeProviders(this.plugin.settings.providers)
			const defaults = sanitizeDefaultSelections(
				this.plugin.settings.providers,
				this.plugin.settings.defaultProviderId,
				this.plugin.settings.defaultModelId,
			)
			this.plugin.settings.defaultProviderId = defaults.defaultProviderId
			this.plugin.settings.defaultModelId = defaults.defaultModelId
			await this.plugin.saveSettings()
			if (showNotice) {
				new Notice(i18n.t('settings.ai.saved'))
			}
		} catch (error) {
			logger.error(error)
			new Notice(i18n.t('settings.ai.errors.saveFailed'))
		}
	}
}
