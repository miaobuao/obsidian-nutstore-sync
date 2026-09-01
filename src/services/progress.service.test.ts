import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitEndSync, emitPreparingSync, emitSyncProgress } from '../events'
import { ProgressService } from './progress.service'

const modal = vi.hoisted(() => ({
	open: vi.fn(),
	close: vi.fn(),
	update: vi.fn(),
}))

vi.mock('../components/SyncProgressModal', () => ({
	default: class {
		open = modal.open
		close = modal.close
		update = modal.update
	},
}))
vi.mock('obsidian', () => ({
	Notice: class {},
}))

describe('ProgressService completion', () => {
	let service: ProgressService

	beforeEach(() => {
		vi.clearAllMocks()
		service = new ProgressService({ isSyncing: true } as never)
		service.onload()
	})

	afterEach(() => {
		service.onunload()
	})

	it('keeps visible zero-task progress open and marks it complete in place', async () => {
		emitPreparingSync({ showNotice: true })
		service.showProgressModal()

		emitEndSync({ showNotice: true, failedCount: 0 })

		expect(modal.open).toHaveBeenCalledOnce()
		expect(modal.close).not.toHaveBeenCalled()
		await vi.waitFor(() => expect(modal.update).toHaveBeenCalled())
	})

	it('keeps visible completed task progress open after a successful sync', async () => {
		emitPreparingSync({ showNotice: true })
		service.showProgressModal()
		emitSyncProgress(2, [], null)

		emitEndSync({ showNotice: true, failedCount: 0 })

		expect(modal.close).not.toHaveBeenCalled()
		await vi.waitFor(() => expect(modal.update).toHaveBeenCalled())
	})

	it('does not reopen a hidden progress modal at completion', () => {
		emitPreparingSync({ showNotice: true })
		service.showProgressModal()
		service.closeProgressModal()

		emitEndSync({ showNotice: true, failedCount: 0 })

		expect(modal.open).toHaveBeenCalledOnce()
		expect(modal.close).toHaveBeenCalledOnce()
	})

	it('updates a progress modal that was reopened before completion', async () => {
		emitPreparingSync({ showNotice: true })
		service.showProgressModal()
		service.closeProgressModal()
		service.showProgressModal()

		emitEndSync({ showNotice: true, failedCount: 0 })

		expect(modal.open).toHaveBeenCalledTimes(2)
		expect(modal.close).toHaveBeenCalledOnce()
		await vi.waitFor(() => expect(modal.update).toHaveBeenCalled())
	})

	it('keeps failed completion in the progress modal with its failure count', async () => {
		emitPreparingSync({ showNotice: true })
		service.showProgressModal()

		emitEndSync({ showNotice: true, failedCount: 2 })

		expect(service.syncFailedCount).toBe(2)
		await vi.waitFor(() => expect(modal.update).toHaveBeenCalled())
		expect(modal.close).not.toHaveBeenCalled()
	})
})
