import { describe, expect, it } from 'vitest'
import { getAgentDefinition } from '~/ai/chat/agents/registry'
import { createSystemPromptForAgent } from './prompts'

describe('main system prompt Skills guidance', () => {
	it('loads matching Skill paths through Bash without use_skill', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const prompt = createSystemPromptForAgent(definition)

		expect(prompt).toContain('skill name, description, and path')
		expect(prompt).toContain('use bash to read the complete SKILL.md')
		expect(prompt).toContain('copy it exactly from workspace context')
		expect(prompt).toContain(
			'Paths under /.agents/skills are user-defined Vault Skills',
		)
		expect(prompt).toContain(
			'paths under /.agents/nutstore-sync/builtin-skills are bundled built-in Skills',
		)
		expect(prompt).toContain('These namespaces are distinct')
		expect(prompt).toContain(
			'Treat every Skill path as an opaque absolute path',
		)
		expect(prompt).not.toContain('call use_skill')
		expect(prompt).not.toContain('background_output')
		expect(prompt).not.toContain('subagent_type')
		expect(prompt).not.toContain('MCP servers are configured')
	})

	it('states the agent identity and its environment', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const prompt = createSystemPromptForAgent(definition)

		expect(prompt).toContain('Nutstore Sync Obsidian plugin')
		expect(prompt).toContain('Obsidian vault')
		expect(prompt).toContain('WebDAV')
	})
})

describe('user-facing path convention', () => {
	it('instructs the master agent to use vault-relative paths when replying to the user', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const prompt = createSystemPromptForAgent(definition)

		expect(prompt).toContain('vault-relative path')
		expect(prompt).toMatch(/never the \/vault absolute path/)
	})

	it('instructs the explorer agent to cite vault files without the /vault prefix', () => {
		const definition = getAgentDefinition('explorer')
		if (!definition) throw new Error('Expected explorer agent definition')
		const prompt = createSystemPromptForAgent(definition)

		expect(prompt).toContain('vault-relative path')
		expect(prompt).toMatch(/never the internal \/vault\/\.\.\. virtual path/)
	})
})

describe('vault instructions', () => {
	it('appends vault instructions wrapped in XML tags when provided', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const instructions = 'Always reply in a friendly tone.'
		const prompt = createSystemPromptForAgent(
			definition,
			undefined,
			instructions,
		)

		expect(prompt).toContain('<vault-instructions>')
		expect(prompt).toContain(instructions)
		expect(prompt).toContain('</vault-instructions>')
	})

	it('omits vault-instructions block when content is empty', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const prompt = createSystemPromptForAgent(definition, undefined, '')

		expect(prompt).not.toContain('<vault-instructions>')
	})

	it('omits vault-instructions block when not provided', () => {
		const definition = getAgentDefinition('master')
		if (!definition) throw new Error('Expected master agent definition')
		const prompt = createSystemPromptForAgent(definition)

		expect(prompt).not.toContain('<vault-instructions>')
	})
})
