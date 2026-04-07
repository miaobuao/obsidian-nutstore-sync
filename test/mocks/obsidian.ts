export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

export class App {}
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
