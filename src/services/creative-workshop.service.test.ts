// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type NutstorePlugin from '~/index'
import type { AgentRunner } from '~/ai/chat/runtime/agent-runner'
import type { ChatSession } from '~/ai/chat/domain'
import { createWorkshopHistory, type AppCode } from '~/ai/apps/domain'
import { ModuleScope } from '~/modules/lifecycle'
import CreativeWorkshopService from './creative-workshop.service'
import { AppStore } from '~/ai/apps/store'

const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('obsidian', () => ({
	TFile: class {},
	normalizePath: (path: string) => path,
}))
vi.mock('~/utils/mkdirs-vault', () => ({ mkdirsVault: async () => {} }))
vi.mock('~/utils/local-vault-io', () => ({
	readLocalText: async (_vault: unknown, path: string) => disk.get(path)!,
	writeLocalTextAtomic: async (
		_vault: unknown,
		path: string,
		content: string,
	) => {
		disk.set(path, content)
	},
}))
vi.mock('~/ai/chat/session/session-files', () => ({
	SessionsFileBackend: class {
		async readArtifact(sessionId: string, id: string) {
			return disk.get(`${sessionId}/${id}`)!
		}
		async writeArtifact(sessionId: string, id: string, content: string) {
			disk.set(`${sessionId}/${id}`, content)
		}
	},
}))
vi.mock('~/ai/catalog/config', () => ({
	getProviderById: () => ({ id: 'provider' }),
	getModelById: () => ({ id: 'model', tool_call: true }),
	resolveInitialSelection: () => ({ providerId: 'provider', modelId: 'model' }),
}))
const code: AppCode = {
	title: '中性工具 Neutral tool 🌿',
	iconSvg:
		'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="currentColor"/></svg>',
	html: '<button>完成 Done 🌿</button>',
	css: '',
	javascript: '',
	dataVersion: 1,
	assets: [],
	sourceRefs: [],
}
type Options = Parameters<AgentRunner['runTurn']>[0]

function fixture() {
	let sequence = 0
	const persisted = new Map<string, ChatSession>()
	const outputs: unknown[] = []
	const previews: Array<CreativeWorkshopService['preview']> = []
	const control = {
		submit: true,
		invalidFirst: false,
		failSave: false,
		stream: false,
	}
	const runner = {
		runTurn: vi.fn(async (options: Options) => {
			if (control.stream) {
				const publish = options.execution!.tools.publish_app
				const context = { toolCallId: 'publish', messages: [], context: {} }
				await publish.onInputStart!(context)
				const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
				try {
					const input = JSON.stringify(code)
					const split = input.indexOf('Done')
					await publish.onInputDelta!({
						...context,
						inputTextDelta: input.slice(0, split),
					})
					now.mockReturnValue(1100)
					await publish.onInputDelta!({
						...context,
						inputTextDelta: input.slice(split),
					})
				} finally {
					now.mockRestore()
				}
			}
			if (control.submit) {
				const publish = options.execution!.tools.publish_app.execute!
				if (control.invalidFirst)
					outputs.push(
						await publish(
							{ ...code, iconSvg: '<svg><script>1</script></svg>' },
							{ toolCallId: 'invalid', messages: [], context: {} },
						),
					)
				outputs.push(
					await publish(code, {
						toolCallId: 'publish',
						messages: [],
						context: {},
					}),
				)
			}
			options.agent.timeline.push({
				id: `message-${sequence++}`,
				role: 'assistant',
				parts: [{ type: 'text', text: '完成 Done 🌿' }],
			})
			return { status: 'completed' as const, text: '完成 Done 🌿' }
		}),
	}
	const chat = {
		createWorkshopSession: async () =>
			({
				schemaVersion: 2,
				id: `session-${sequence++}`,
				createdAt: 1,
				updatedAt: 1,
				model: { providerId: 'provider', modelId: 'model' },
				workshop: createWorkshopHistory(),
				subagents: {
					master: {
						id: 'master',
						type: 'master',
						status: 'idle',
						createdAt: 1,
						timeline: [],
						pendingInputs: [],
						operations: {},
						toolTimings: {},
						subagents: {},
					},
				},
			}) as ChatSession,
		persistWorkshopSession: vi.fn(async (session: ChatSession) => {
			if (control.failSave) throw new Error('Persistence failed')
			persisted.set(session.id, structuredClone(session))
		}),
		listWorkshopSessions: async () =>
			[...persisted.values()].map((session) => ({ id: session.id })),
		loadWorkshopSession: async (id: string) =>
			structuredClone(persisted.get(id)!),
		getAppBuildRunner: () => runner,
	}
	const app = {
		workspace: { containerEl: document.body },
		vault: { adapter: {} },
		fileManager: {},
		metadataCache: {},
	}
	const plugin = {
		app,
		settings: { ai: { providers: {}, defaultModel: undefined } },
		ai: { chat, gateway: { ensureProviderReady: async () => {} } },
	} as unknown as NutstorePlugin
	const scope = new ModuleScope()
	const store = new AppStore(app as never)
	const service = new CreativeWorkshopService(plugin, scope, store)
	const validator = vi.fn(async () => {})
	service.setValidator(validator)
	service.subscribe(() => {
		if (service.preview) previews.push(structuredClone(service.preview))
	})
	return {
		service,
		store,
		scope,
		control,
		outputs,
		persisted,
		validator,
		chat,
		previews,
	}
}
async function idle(service: CreativeWorkshopService) {
	await (service as unknown as { active?: { done: Promise<void> } }).active
		?.done
}
beforeEach(() => disk.clear())
describe('Creative Workshop builds', () => {
	it('presents partial multilingual markup before publication and discards it when the build settles', async () => {
		const f = fixture()
		f.control.stream = true
		await f.service.submit('制作按钮 Build a button 🌿')
		await idle(f.service)
		expect(
			f.previews.some(
				(preview) => preview?.html === '<button>完成 ' && !preview.complete,
			),
		).toBe(true)
		expect(
			f.previews.some(
				(preview) => preview?.html === code.html && !preview.complete,
			),
		).toBe(true)
		expect(f.previews.some((preview) => preview?.complete)).toBe(true)
		expect(f.service.preview).toBeUndefined()
		expect(
			[...f.persisted.values()].every((session) => !('preview' in session)),
		).toBe(true)
		expect(f.service.revision?.code.html).toBe(code.html)
	})
	it('requires publication, reports invalid icons and allows a corrected submission', async () => {
		const f = fixture()
		f.control.invalidFirst = true
		await f.service.submit('制作中性工具 Build a neutral tool 🌿')
		await idle(f.service)
		expect(f.outputs[0]).toMatchObject({ ok: false })
		expect(f.outputs[1]).toMatchObject({ ok: true })
		expect(f.validator).toHaveBeenCalledTimes(1)
		expect(f.service.history?.turns[0]).toMatchObject({
			status: 'completed',
			messageIds: ['message-1'],
		})
		f.control.submit = false
		await f.service.submit('调整工具 Modify the tool 🌿')
		await idle(f.service)
		expect(f.service.history?.turns[1].status).toBe('failed')
		expect(f.service.revision?.code.title).toBe(code.title)
	})
	it('saves draft data once, modifies independent code and can reopen after conversation removal', async () => {
		const f = fixture()
		await f.service.submit('制作计数器 Build a counter 🌿')
		await idle(f.service)
		const revision = f.service.revision!
		await Promise.all([
			f.service.transact(revision.id, [{ key: '次数 Count 🌿', value: 3 }]),
			f.service.transact(revision.id, [
				{ key: '标题 Title 中文', value: '记录 Record 🧭' },
			]),
		])
		const [firstId, secondId] = await Promise.all([
			f.service.saveApp(),
			f.service.saveApp(),
		])
		expect(firstId).toBe(secondId)
		expect((await f.store.read(firstId)).record.kv).toEqual({
			'次数 Count 🌿': 3,
			'标题 Title 中文': '记录 Record 🧭',
		})
		expect(f.service.history).toMatchObject({
			appId: firstId,
			draftRevision: undefined,
			draftKV: {},
		})
		await f.service.submit('增加说明 Add instructions 🌿')
		await idle(f.service)
		expect((await f.store.read(firstId)).record.revisionIds).toHaveLength(2)
		const oldSessionId = f.service.session!.id
		await f.service.newApp()
		f.persisted.delete(oldSessionId)
		await f.service.editApp(firstId)
		expect(f.service.history?.appId).toBe(firstId)
		expect(await f.service.readKV(f.service.revision!.id)).toMatchObject({
			'次数 Count 🌿': 3,
		})
	})
	it('failed draft writes roll back and old revision capabilities cannot mutate a new draft', async () => {
		const f = fixture()
		await f.service.submit('保存进度 Save progress 🌿')
		await idle(f.service)
		const id = f.service.revision!.id
		f.control.failSave = true
		await expect(
			f.service.transact(id, [{ key: '进度 Progress 🌿', value: 1 }]),
		).rejects.toThrow('Persistence failed')
		expect(await f.service.readKV(id)).toEqual({})
		f.control.failSave = false
		await f.service.newApp()
		await expect(
			f.service.transact(id, [{ key: '进度 Progress 🌿', value: 2 }]),
		).rejects.toThrow('no longer active')
	})
	it('candidate startup failure preserves the last working code and business data', async () => {
		const f = fixture()
		await f.service.submit('创建工具 Create tool 🌿')
		await idle(f.service)
		const last = f.service.revision!
		await f.service.transact(last.id, [
			{ key: '文本 Text 🌿', value: '记录 Record 中文' },
		])
		f.service.setValidator(async () => {
			throw new Error('Startup failed')
		})
		await f.service.submit('修改工具 Modify tool 🌿')
		await idle(f.service)
		expect(f.outputs.at(-1)).toMatchObject({
			ok: false,
			error: expect.stringContaining('Startup failed'),
		})
		expect(f.service.revision?.id).toBe(last.id)
		expect(await f.service.readKV(last.id)).toEqual({
			'文本 Text 🌿': '记录 Record 中文',
		})
	})
})
