import { cloneDeep } from 'lodash-es'
import { Modal, Notice, Setting } from 'obsidian'
import { createModelDraft } from '~/ai/config'
import { AIModelConfig, AIProviderConfig, OpenAIChatProviderType } from '~/ai/types'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'
import ModelEditorModal from './ModelEditorModal'

export default class ProviderEditorModal extends Modal {
	private draft: AIProviderConfig

	constructor(
		private plugin: NutstorePlugin,
		provider: AIProviderConfig,
		private onSave: (provider: AIProviderConfig) => Promise<void> | void,
		private isNew: boolean,
	) {
		super(plugin.app)
		this.draft = cloneDeep(provider)
	}

	onOpen() {
		this.render()
	}

	private render() {
		const { contentEl } = this
		contentEl.empty()
		const currentType = this.draft.type as string
		const typeOptions: Array<{ value: OpenAIChatProviderType; label: string }> = [
			{
				value: 'openai-chat',
				label: i18n.t('settings.ai.provider.type.openai'),
			},
		]
		const hasValidType = typeOptions.some((option) => option.value === currentType)
		contentEl.createEl('h2', {
			text: this.isNew
				? i18n.t('settings.ai.modals.provider.createTitle')
				: i18n.t('settings.ai.modals.provider.editTitle'),
		})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.type.name'))
			.setDesc(i18n.t('settings.ai.provider.type.desc'))
			.then((s) => s.settingEl.addClass('setting-required'))
			.addDropdown((dropdown) => {
				for (const option of typeOptions) {
					dropdown.addOption(option.value, option.label)
				}

				if (!hasValidType) {
					dropdown.addOption(
						currentType,
						i18n.t('settings.ai.provider.type.invalid', {
							value: currentType,
						}),
					)
				}

				dropdown
					.setValue(currentType)
					.setDisabled(!this.isNew && hasValidType)
					.onChange((value) => {
						this.draft.type = value as OpenAIChatProviderType
					})
			})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.name'))
			.setDesc(i18n.t('settings.ai.provider.desc'))
			.then((s) => s.settingEl.addClass('setting-required'))
			.addText((text) =>
				text.setValue(this.draft.name).onChange((value) => {
					this.draft.name = value
				}),
			)

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.baseUrl.name'))
			.setDesc(i18n.t('settings.ai.provider.baseUrl.desc'))
			.then((s) => s.settingEl.addClass('setting-optional'))
			.addText((text) =>
				text
					.setPlaceholder('https://api.openai.com/v1')
					.setValue(this.draft.baseUrl || '')
					.onChange((value) => {
						this.draft.baseUrl = value.trim() || undefined
					}),
			)

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.apiKey.name'))
			.setDesc(i18n.t('settings.ai.provider.apiKey.desc'))
			.then((s) => s.settingEl.addClass('setting-required'))
			.addText((text) => {
				text.setValue(this.draft.apiKey).onChange((value) => {
					this.draft.apiKey = value
				})
				text.inputEl.type = 'password'
			})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.organization.name'))
			.setDesc(i18n.t('settings.ai.provider.organization.desc'))
			.then((s) => s.settingEl.addClass('setting-optional'))
			.addText((text) =>
				text.setValue(this.draft.organization || '').onChange((value) => {
					this.draft.organization = value.trim() || undefined
				}),
			)

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.provider.project.name'))
			.setDesc(i18n.t('settings.ai.provider.project.desc'))
			.then((s) => s.settingEl.addClass('setting-optional'))
			.addText((text) =>
				text.setValue(this.draft.project || '').onChange((value) => {
					this.draft.project = value.trim() || undefined
				}),
			)

		const modelContainer = contentEl.createDiv()
		new Setting(modelContainer)
			.setName(i18n.t('settings.ai.models.name'))
			.setDesc(i18n.t('settings.ai.models.desc'))
			.addButton((button) =>
				button.setButtonText(i18n.t('settings.ai.models.add')).onClick(() => {
					new ModelEditorModal(
						this.plugin,
						createModelDraft(),
						async (model) => {
							this.draft.models.push(model)
							this.render()
						},
						true,
					).open()
				}),
			)

		if (this.draft.models.length === 0) {
			modelContainer.createDiv({
				cls: 'setting-item-description',
				text: i18n.t('settings.ai.models.empty'),
			})
		}

		for (const model of this.draft.models) {
			new Setting(modelContainer)
				.setName(model.name || i18n.t('settings.ai.unnamedModel'))
				.addButton((button) =>
					button
						.setButtonText(i18n.t('settings.ai.modals.model.edit'))
						.onClick(() => {
							new ModelEditorModal(
								this.plugin,
								model,
								async (savedModel) => {
									const index = this.draft.models.findIndex(
										(item) => item.id === savedModel.id,
									)
									if (index >= 0) {
										this.draft.models[index] = savedModel
										this.render()
									}
								},
								false,
							).open()
						}),
				)
				.addExtraButton((button) => {
					let confirmDelete = false
					button
						.setIcon('trash')
						.setTooltip(i18n.t('settings.ai.models.delete'))
						.onClick(() => {
							if (!confirmDelete) {
								confirmDelete = true
								button.setIcon('alert-triangle')
								button.setTooltip(i18n.t('settings.ai.modals.confirmDelete'))
								return
							}
							this.deleteModel(model)
						})
					button.extraSettingsEl.addEventListener('blur', () => {
						confirmDelete = false
						button.setIcon('trash')
						button.setTooltip(i18n.t('settings.ai.models.delete'))
					})
				})
		}

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.filters.save'))
					.setCta()
					.onClick(async () => {
						try {
							await this.onSave(cloneDeep(this.draft))
							new Notice(i18n.t('settings.ai.modals.provider.saved'))
							this.close()
						} catch (error) {
							logger.error(error)
							new Notice(i18n.t('settings.ai.errors.saveFailed'))
						}
					}),
			)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.filters.cancel'))
					.onClick(() => this.close()),
			)
	}

	private deleteModel(model: AIModelConfig) {
		this.draft.models = this.draft.models.filter((item) => item.id !== model.id)
		new Notice(i18n.t('settings.ai.modals.model.deleted'))
		this.render()
	}

	onClose() {
		this.contentEl.empty()
	}
}
