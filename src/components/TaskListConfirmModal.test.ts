import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '~/i18n'

const h = vi.hoisted(() => ({
	buttons: [] as Array<{ text: string; click: () => void }>,
	listProps: undefined as
		| {
				onToggle: (index: number, checked: boolean) => void
				onToggleMany: (indices: number[], checked: boolean) => void
		  }
		| undefined,
}))

vi.mock('obsidian', () => {
	class Modal {
		contentEl = {
			empty: vi.fn(),
			createDiv: vi.fn(() => ({ style: {} })),
		}

		constructor(_app: unknown) {}
		setTitle(_title: string) {}
		close() {}
	}

	class Setting {
		constructor(_containerEl: unknown) {}

		addButton(
			callback: (button: {
				setButtonText(text: string): unknown
				setCta(): unknown
				onClick(handler: () => void): unknown
			}) => void,
		) {
			const button = {
				text: '',
				click: () => {},
				setButtonText(text: string) {
					button.text = text
					return button
				},
				setCta() {
					return button
				},
				onClick(handler: () => void) {
					button.click = handler
					return button
				},
			}
			callback(button)
			h.buttons.push(button)
			return this
		}
	}

	return { Modal, Setting }
})

vi.mock('../components/solid-js', () => ({
	mountTaskSelectionVirtualList: vi.fn(
		(_container: unknown, props: typeof h.listProps) => {
			h.listProps = props
			return {
				update: vi.fn(),
				destroy: vi.fn(),
			}
		},
	),
}))

vi.mock('~/utils/get-task-name', () => ({
	default: vi.fn(() => '同步 / Sync'),
}))

import TaskListConfirmModal from './TaskListConfirmModal'

function createModal() {
	const tasks = [
		{ localPath: 'a.md', remotePath: '/a.md' },
		{ localPath: 'b.md', remotePath: '/b.md' },
		{ localPath: 'c.md', remotePath: '/c.md' },
	] as never[]
	return new TaskListConfirmModal({} as never, tasks)
}

describe('TaskListConfirmModal selected task count', () => {
	beforeEach(() => {
		h.buttons = []
		h.listProps = undefined
	})

	it.each([
		['en', 'Continue (3)', 'Continue (2)', 'Continue (0)'],
		['zh', '继续（3）', '继续（2）', '继续（0）'],
	] as const)(
		'updates the continue label for the selected count in %s',
		async (language, initialLabel, afterOneToggle, afterAllToggled) => {
			await i18n.changeLanguage(language)
			const modal = createModal()

			modal.onOpen()

			expect(h.buttons[0]?.text).toBe(initialLabel)
			h.listProps?.onToggle(0, false)
			expect(h.buttons[0]?.text).toBe(afterOneToggle)
			h.listProps?.onToggleMany([1, 2], false)
			expect(h.buttons[0]?.text).toBe(afterAllToggled)
		},
	)

	it.each([
		['en', 'Continue (1)'],
		['zh', '继续（1）'],
	] as const)(
		'keeps the total count when toggling filtered items in %s',
		async (language, label) => {
			await i18n.changeLanguage(language)
			const modal = createModal()

			modal.onOpen()
			h.listProps?.onToggleMany([0, 2], false)

			expect(h.buttons[0]?.text).toBe(label)
		},
	)
})
