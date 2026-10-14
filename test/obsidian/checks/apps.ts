import type { App } from 'obsidian'
import type NutstorePlugin from '~/index'
import type { AgentRunner } from '~/ai/chat/runtime/agent-runner'
import type CreativeWorkshopView from '~/views/creative-workshop.view'
import { CREATIVE_WORKSHOP_VIEW_TYPE } from '~/views/creative-workshop.view'
import { APP_VIEW_TYPE } from '~/views/app.view'
import { createProviderConfig } from '~/ai/catalog/config'
import type { AppCode } from '~/ai/apps/domain'
import { assert } from './assert'
import { ModuleState } from '~/modules/lifecycle'

async function waitUntil(
	check: () => boolean | Promise<boolean>,
	timeout = 15000,
) {
	const end = Date.now() + timeout
	while (!(await check())) {
		if (Date.now() > end) throw new Error('App check timed out')
		await new Promise((resolve) => window.setTimeout(resolve, 50))
	}
}

/** Real Obsidian exercises srcdoc, CSP, bridge, independent disk state and pin lifecycle. No model/network required. */
export async function createsIndependentApps(app: App) {
	const plugin = (
		app as unknown as { plugins: { plugins: Record<string, NutstorePlugin> } }
	).plugins.plugins['nutstore-sync']
	const service = plugin.ai.workshop
	const runner = plugin.ai.chat.getAppBuildRunner()
	const originalRun = runner.runTurn
	const originalReady = plugin.ai.gateway.ensureProviderReady
	const hasWorkshopCommand = () =>
		!!(app as unknown as { commands: { commands: Record<string, unknown> } })
			.commands.commands['nutstore-sync:open-creative-workshop']
	const providerId = 'neutral-app-provider'
	const before = plugin.settings.ai.providers[providerId]
	plugin.settings.ai.providers[providerId] = createProviderConfig({
		id: providerId,
		name: '中性模型 Neutral model 🌿',
		npm: '@ai-sdk/openai-compatible',
		models: {
			'neutral-model': {
				id: 'neutral-model',
				name: '中性模型 Neutral model 🌿',
				tool_call: true,
			},
		},
	})
	plugin.ai.gateway.ensureProviderReady = async () => {}
	let savedId: string | undefined
	let generation = 0
	const code: AppCode = {
		title: '中性计数器 Neutral counter 🌿',
		iconSvg:
			'<svg viewBox="0 0 100 100"><path d="M20 50 H80 M50 20 V80" fill="none" stroke="currentColor" stroke-width="12"/></svg>',
		html: '<h1>中性计数器 Neutral counter 🌿</h1><button id="increment">增加 Add 🌿</button><output id="count"></output>',
		css: 'button{padding:12px}output{display:block;font-size:2rem}',
		javascript:
			'const key = "次数 Count 🌿"; let count = (await app.kv.get(key)) ?? 0; const output = document.querySelector("#count"); output.textContent = count; document.querySelector("#increment").addEventListener("click", async () => { count += 1; await app.kv.set(key, count); output.textContent = count; }); window.addEventListener("message", event => { if(event.data?.test === "increment") document.querySelector("#increment").click(); }); let isolated = false; try { void parent.document.body; } catch { isolated = true; } await app.kv.set("隔离 Isolation 🌿", isolated);',
		dataVersion: 1,
		assets: [],
		sourceRefs: [],
	}
	runner.runTurn = (async (options: Parameters<AgentRunner['runTurn']>[0]) => {
		generation++
		const tool = options.execution!.tools.publish_app
		const context = {
			toolCallId: `publish-${generation}`,
			messages: [],
			context: {},
		}
		const workshop = app.workspace.getLeavesOfType(
			CREATIVE_WORKSHOP_VIEW_TYPE,
		)[0].view as CreativeWorkshopView
		assert(
			!workshop.contentEl.querySelector('.is-home'),
			'Composer stayed on the landing page while building',
		)
		await tool.onInputStart!(context)
		await tool.onInputDelta!({
			...context,
			inputTextDelta: JSON.stringify({
				title: code.title,
				html: code.html,
			}).slice(0, -1),
		})
		const preview = workshop.contentEl.querySelector<HTMLIFrameElement>(
			'.ns-workshop-preview iframe',
		)!
		assert(
			!!preview && preview.getAttribute('sandbox') === 'allow-scripts',
			'Streaming page preview is missing or not isolated',
		)
		const timeline = workshop.contentEl.querySelector<HTMLDetailsElement>(
			'.ns-workshop-timeline',
		)!
		const output = workshop.contentEl.querySelector<HTMLElement>(
			'.ns-workshop-output',
		)!
		const previewHeight = output.getBoundingClientRect().height
		timeline.open = true
		assert(
			output.getBoundingClientRect().height === previewHeight,
			'Expanding the floating timeline resized the App preview',
		)
		await new Promise((resolve) => window.setTimeout(resolve, 120))
		await tool.onInputDelta!({
			...context,
			inputTextDelta: `,"css":${JSON.stringify(code.css)}}`,
		})
		assert(
			workshop.contentEl.querySelector('.ns-workshop-preview iframe') ===
				preview,
			'Streaming update reloaded the preview frame',
		)
		assert(timeline.open, 'Progress updates collapsed the build timeline')
		assert(
			workshop.contentEl
				.querySelector('.ns-workshop-transcript')
				?.textContent?.includes('🌿'),
			'Request text is missing from the shared transcript',
		)
		const publish = tool.execute!
		const result = await publish(
			{ ...code, title: generation === 1 ? code.title : `${code.title} 2` },
			{ toolCallId: `publish-${generation}`, messages: [], context: {} },
		)
		assert(
			(result as { ok?: boolean }).ok,
			`App publish failed: ${JSON.stringify(result)}`,
		)
		options.agent.timeline.push({
			id: `neutral-app-result-${generation}`,
			role: 'assistant',
			parts: [{ type: 'text', text: '制作完成 App completed 🌿' }],
		})
		return { status: 'completed', text: '制作完成 App completed 🌿' }
	}) as AgentRunner['runTurn']
	try {
		await plugin.ai.openWorkshop()
		const leaf = app.workspace.getLeavesOfType(CREATIVE_WORKSHOP_VIEW_TYPE)[0]
		const view = leaf.view as CreativeWorkshopView
		await service.newApp()
		assert(
			!!view.contentEl.querySelector('.is-home'),
			'New App did not restore the centered composer',
		)
		const stageBounds = view.contentEl
			.querySelector('.ns-workshop-stage')!
			.getBoundingClientRect()
		const composerBounds = view.contentEl
			.querySelector('.ns-workshop-composer')!
			.getBoundingClientRect()
		assert(
			Math.abs(
				composerBounds.top +
					composerBounds.height / 2 -
					stageBounds.top -
					stageBounds.height / 2,
			) < 2,
			'Landing welcome flow is not vertically centered',
		)
		service.session!.model = { providerId, modelId: 'neutral-model' }
		await service.submit('做一个能保存次数的工具 Build a persistent counter 🌿')
		await waitUntil(() => !service.running)
		assert(
			service.history?.turns[0].status === 'completed',
			service.error ?? 'App generation failed',
		)
		assert(service.revision?.code.title === code.title, 'Published App missing')
		await waitUntil(
			async () =>
				(await service.readKV(service.revision!.id))['隔离 Isolation 🌿'] ===
				true,
		)
		const draftFrame = view.contentEl.querySelector<HTMLIFrameElement>(
			'.ns-workshop-output iframe',
		)!
		assert(
			draftFrame.getAttribute('sandbox') === 'allow-scripts',
			'Sandbox permissions too broad',
		)
		draftFrame.contentWindow!.postMessage({ test: 'increment' }, '*')
		await waitUntil(
			async () =>
				(await service.readKV(service.revision!.id))['次数 Count 🌿'] === 1,
		)
		savedId = await service.saveApp()
		const firstRevision = service.revision!.id
		await plugin.ai.apps.setPinned(savedId, true)
		await waitUntil(
			() =>
				!!app.workspace.containerEl.querySelector(
					`[data-nutstore-app-id="${savedId}"]`,
				),
		)
		const ribbon = app.workspace.containerEl.querySelector<HTMLElement>(
			`[data-nutstore-app-id="${savedId}"]`,
		)!
		assert(
			!!ribbon.querySelector('svg path'),
			'Custom App SVG was not used in the ribbon',
		)
		ribbon.click()
		await waitUntil(() =>
			app.workspace
				.getLeavesOfType(APP_VIEW_TYPE)
				.some((item) => item.view.getState().appId === savedId),
		)
		const appLeaf = app.workspace
			.getLeavesOfType(APP_VIEW_TYPE)
			.find((item) => item.view.getState().appId === savedId)!
		assert(
			appLeaf.view.getDisplayText().includes('Neutral counter'),
			'App tab title lost identity',
		)
		await service.submit('调整标题 Update the title 🌿')
		await waitUntil(() => !service.running)
		assert(
			service.history?.turns[1].status === 'completed',
			service.error ?? 'App modification failed',
		)
		assert(
			(await plugin.ai.apps.read(savedId)).record.kv['次数 Count 🌿'] === 1,
			'Code update lost data',
		)
		await plugin.ai.apps.restore(savedId, firstRevision)
		assert(
			(await plugin.ai.apps.read(savedId)).record.kv['次数 Count 🌿'] === 1,
			'Code restore rolled back business data',
		)
		const buildId = service.session!.id
		await service.newApp()
		await plugin.ai.chat.deleteSession(buildId)
		assert(
			(await plugin.ai.apps.read(savedId)).record.kv['次数 Count 🌿'] === 1,
			'Deleting conversation deleted App data',
		)
		appLeaf.detach()
		await plugin.ai.openApp(savedId)
		assert(
			app.workspace
				.getLeavesOfType(APP_VIEW_TYPE)
				.some((item) => item.view.getState().appId === savedId),
			'App could not reopen independently',
		)
		assert(
			app.workspace.containerEl.querySelectorAll('[data-nutstore-workshop]')
				.length === 1,
			'Workshop ribbon entry is missing or duplicated',
		)
		assert(hasWorkshopCommand(), 'Enabled workshop has no command entry')
		await plugin.settingsService.setWorkshopEnabled(false)
		assert(
			!app.workspace.containerEl.querySelector('[data-nutstore-workshop]'),
			'Disabled workshop left its ribbon entry behind',
		)
		assert(
			!hasWorkshopCommand(),
			'Disabled workshop left its command entry behind',
		)
		assert(
			!!app.workspace.containerEl.querySelector(
				`[data-nutstore-app-id="${savedId}"]`,
			),
			'Disabling workshop removed the independently pinned App',
		)
		await plugin.settingsService.setWorkshopEnabled(true)
		assert(
			app.workspace.containerEl.querySelectorAll('[data-nutstore-workshop]')
				.length === 1,
			'Re-enabling workshop did not restore exactly one ribbon entry',
		)
		assert(
			hasWorkshopCommand(),
			'Re-enabling workshop did not restore its command entry',
		)
		;(
			app.workspace.containerEl.querySelector(
				'[data-nutstore-workshop]',
			) as HTMLElement
		).click()
		await waitUntil(
			() =>
				app.workspace.getLeavesOfType(CREATIVE_WORKSHOP_VIEW_TYPE).length === 1,
		)
		await plugin.settingsService.setModuleState('ai', ModuleState.Disabled)
		assert(
			!plugin.ai.lifecycle.active,
			`AI did not disable: ${plugin.localSettings.modules.ai}`,
		)
		assert(
			!app.workspace.containerEl.querySelector(
				`[data-nutstore-app-id="${savedId}"]`,
			),
			'Disabling AI left App ribbon entries behind',
		)
		assert(
			!app.workspace.containerEl.querySelector('[data-nutstore-workshop]'),
			'Disabling AI left the workshop ribbon entry behind',
		)
		await plugin.settingsService.setModuleState('ai', ModuleState.Enabled)
		await waitUntil(
			() =>
				app.workspace.containerEl.querySelectorAll(
					`[data-nutstore-app-id="${savedId}"]`,
				).length === 1,
		)
		assert(
			(await plugin.ai.apps.read(savedId)).record.kv['次数 Count 🌿'] === 1,
			'Reactivation lost App business data',
		)
		assert(
			app.workspace.containerEl.querySelectorAll('[data-nutstore-workshop]')
				.length === 1,
			'Reactivating AI duplicated or omitted the workshop ribbon entry',
		)
	} finally {
		if (!plugin.ai.lifecycle.active)
			await plugin.settingsService.setModuleState('ai', ModuleState.Enabled)
		if (!plugin.ai.workshopLifecycle.active)
			await plugin.settingsService.setWorkshopEnabled(true)
		runner.runTurn = originalRun
		plugin.ai.gateway.ensureProviderReady = originalReady
		if (before) plugin.settings.ai.providers[providerId] = before
		else delete plugin.settings.ai.providers[providerId]
		for (const leaf of app.workspace.getLeavesOfType(APP_VIEW_TYPE))
			leaf.detach()
		if (savedId) await plugin.ai.apps.remove(savedId)
	}
}
