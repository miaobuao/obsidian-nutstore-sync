import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
	buttons: [] as Array<() => void | Promise<void>>,
	close: vi.fn(),
}))

vi.mock('obsidian', () => {
	class Modal {
		contentEl = {
			empty: vi.fn(),
			createEl: vi.fn(() => ({ style: {} })),
			createDiv: vi.fn(() => ({ empty: vi.fn() })),
		}

		constructor(_app: unknown) {}

		close() {
			harness.close()
		}
	}

	class Setting {
		settingEl = {
			classList: { add: vi.fn() },
		}

		constructor(_containerEl: unknown) {}

		setName(_name: string) {
			return this
		}

		setDesc(_description: string) {
			return this
		}

		then(callback: (setting: this) => void) {
			callback(this)
			return this
		}

		addText(
			callback: (text: {
				setPlaceholder(value: string): unknown
				setValue(value: string): unknown
				onChange(handler: (value: string) => void): unknown
			}) => void,
		) {
			const text = {
				setPlaceholder(_value: string) {
					return text
				},
				setValue(_value: string) {
					return text
				},
				onChange(_handler: (value: string) => void) {
					return text
				},
			}
			callback(text)
			return this
		}

		addToggle(
			callback: (toggle: {
				setValue(value: boolean): unknown
				onChange(handler: (value: boolean) => void): unknown
			}) => void,
		) {
			const toggle = {
				setValue(_value: boolean) {
					return toggle
				},
				onChange(_handler: (value: boolean) => void) {
					return toggle
				},
			}
			callback(toggle)
			return this
		}

		addButton(
			callback: (button: {
				setButtonText(value: string): unknown
				setCta(): unknown
				setIcon(value: string): unknown
				setTooltip(value: string): unknown
				onClick(handler: () => void | Promise<void>): unknown
			}) => void,
		) {
			const button = {
				setButtonText(_value: string) {
					return button
				},
				setCta() {
					return button
				},
				setIcon(_value: string) {
					return button
				},
				setTooltip(_value: string) {
					return button
				},
				onClick(handler: () => void | Promise<void>) {
					harness.buttons.push(handler)
					return button
				},
			}
			callback(button)
			return this
		}
	}

	return { Modal, Notice: class {}, Setting }
})

import McpServerEditorModal from './McpServerEditorModal'

describe('McpServerEditorModal saving', () => {
	beforeEach(() => {
		harness.buttons = []
		harness.close.mockReset()
	})

	it('keeps the editor open when the save callback fails', async () => {
		const onSave = vi.fn(async () => false)
		const modal = new McpServerEditorModal(
			{ app: {} } as never,
			{
				name: 'neutral-server',
				config: {
					type: 'http',
					url: 'https://example.com/mcp',
					enabled: true,
				},
			},
			onSave,
			false,
		)

		modal.onOpen()
		expect(harness.buttons).toHaveLength(2)
		await harness.buttons[1]!()

		expect(onSave).toHaveBeenCalledWith({
			name: 'neutral-server',
			config: {
				type: 'http',
				url: 'https://example.com/mcp',
				enabled: true,
				headers: undefined,
			},
		})
		expect(harness.close).not.toHaveBeenCalled()
	})
})
