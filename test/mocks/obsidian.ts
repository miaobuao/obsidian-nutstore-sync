export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class App {}
export class Modal {
	contentEl = {
		empty() {},
		createEl(_tag: string, _attrs?: { text?: string }) {
			return {
				style: {},
			}
		},
	}

	constructor(_app: App) {}

	setTitle(_title: string) {}
	open() {}
	close() {}
}

export class Setting {
	constructor(_containerEl: unknown) {}

	addButton(
		callback: (button: {
			setButtonText(text: string): any
			setWarning(): any
			setCta(): any
			onClick(handler: () => void): any
		}) => void,
	) {
		const button = {
			setButtonText(_text: string) {
				return button
			},
			setWarning() {
				return button
			},
			setCta() {
				return button
			},
			onClick(_handler: () => void) {
				return button
			},
		}
		callback(button)
		return this
	}
}
export class TFile {}
export class TFolder {}
export class Component {
	load() {}
	unload() {}
}
export class ItemView {}
export class WorkspaceLeaf {}

export const MarkdownRenderer = {
	async render() {},
}

export function normalizePath(path: string) {
	return path
}
