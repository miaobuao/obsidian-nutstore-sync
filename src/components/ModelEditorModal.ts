import { cloneDeep } from 'lodash-es'
import { Modal, Notice, Setting } from 'obsidian'
import { AIModelConfig } from '~/ai/types'
import i18n from '~/i18n'
import logger from '~/utils/logger'
import type NutstorePlugin from '..'

export default class ModelEditorModal extends Modal {
	private draft: AIModelConfig

	constructor(
		private plugin: NutstorePlugin,
		model: AIModelConfig,
		private onSave: (model: AIModelConfig) => Promise<void> | void,
		private isNew: boolean,
	) {
		super(plugin.app)
		this.draft = cloneDeep(model)
	}

	onOpen() {
		const { contentEl } = this
		contentEl.empty()
		contentEl.createEl('h2', {
			text: this.isNew
				? i18n.t('settings.ai.modals.model.createTitle')
				: i18n.t('settings.ai.modals.model.editTitle'),
		})

		new Setting(contentEl)
			.setName(i18n.t('settings.ai.model.name'))
			.setDesc(i18n.t('settings.ai.model.desc'))
			.then((s) => s.settingEl.addClass('setting-required'))
			.addText((text) =>
				text.setValue(this.draft.name).onChange((value) => {
					this.draft.name = value
				}),
			)

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(i18n.t('settings.filters.save'))
					.setCta()
					.onClick(async () => {
						try {
							await this.onSave(cloneDeep(this.draft))
							new Notice(i18n.t('settings.ai.modals.model.saved'))
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

	onClose() {
		this.contentEl.empty()
	}
}
