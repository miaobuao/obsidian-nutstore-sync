import { describe, expect, it } from 'vitest'
import type { ChatSession } from '~/ai/chat/domain'
import { createEmptyMasterAgent } from '~/ai/chat/messages/ui-message'
import { createAppBuildTurn, createWorkshopHistory } from './domain'
import { buildWorkshopTimeline } from './timeline'

describe('workshop transcript', () => {
	it('keeps earlier turns paired while the next response streams before messageIds settle', () => {
		const master = createEmptyMasterAgent(1)
		master.timeline = [
			{
				id: 'first-reply',
				role: 'assistant',
				parts: [{ type: 'text', text: '布局完成 Layout ready 🌿' }],
			},
			{
				id: 'next-reply',
				role: 'assistant',
				parts: [
					{
						type: 'dynamic-tool',
						toolName: 'publish_app',
						toolCallId: 'publish-neutral',
						state: 'input-available',
						input: { title: '中性工具 Neutral tool 🌿' },
					},
				],
			},
		]
		const history = createWorkshopHistory()
		const first = {
			...createAppBuildTurn('搭建页面 Build a page 🌿'),
			status: 'completed' as const,
			messageIds: ['first-reply'],
		}
		const second = createAppBuildTurn('增加按钮 Add a button 🌿')
		history.turns = [first, second]
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'neutral-session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master },
			workshop: history,
		}
		const timeline = buildWorkshopTimeline(session)
		expect(timeline.map((item) => item.message.id)).toEqual([
			first.id,
			'first-reply',
			second.id,
			'next-reply',
		])
		expect(timeline[2].message.parts).toEqual([
			{ type: 'text', text: '增加按钮 Add a button 🌿' },
		])
		expect(timeline[3].displayBlocks[0]).toMatchObject({
			kind: 'tool-call',
			toolCall: { toolName: 'publish_app' },
		})
		second.messageIds = ['next-reply']
		expect(buildWorkshopTimeline(session)).toEqual(timeline)
	})
	it('shows a request and its failure even when execution never produced a message', () => {
		const history = createWorkshopHistory()
		const turn = {
			...createAppBuildTurn('生成页面 Generate a page 🌿'),
			status: 'failed' as const,
			error: '模型未配置 Model unavailable 🌿',
		}
		history.turns.push(turn)
		const session: ChatSession = {
			schemaVersion: 2,
			id: 'neutral-session',
			createdAt: 1,
			updatedAt: 1,
			subagents: { master: createEmptyMasterAgent(1) },
			workshop: history,
		}
		const timeline = buildWorkshopTimeline(session)
		expect(timeline).toHaveLength(2)
		expect(timeline[1].message).toMatchObject({
			metadata: { status: 'error' },
			parts: [{ type: 'text', text: turn.error }],
		})
	})
})
