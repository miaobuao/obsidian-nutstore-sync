import type { ToolSet } from 'ai'
import { isMcpToolName } from '~/ai/mcp/types'

export type AgentPermissionMode = 'ask' | 'readonly' | 'full'

export interface AgentDefinition {
	id: string
	description: string
	systemPrompt: string
	tools: readonly string[]
	permissionMode: AgentPermissionMode
	/** Whether this agent type can be dispatched via the `task` tool. */
	dispatchable: boolean
}

export interface AgentDefinitionSettings {
	fullAccess: boolean
}

export const MASTER_AGENT_ID = 'master'
export const EXPLORER_AGENT_ID = 'explorer'

const MASTER_SYSTEM_PROMPT = [
	'You are the AI agent (ChatBox) built into the Nutstore Sync Obsidian plugin, which synchronizes an Obsidian vault with Nutstore over WebDAV.',
	'Use vault tools directly for focused file operations.',
	'Write temporary, scratch, debug, and log files under /.agents/nutstore-sync/tmp. The bash default cwd is the filesystem root, which is the Obsidian vault, so relative paths resolve to vault files unless you intentionally use an absolute plugin-internal path.',
	'Tools address vault files using the real vault-relative virtual paths (for example notes/idea.md or /notes/idea.md). When you reply, refer to vault files by their vault-relative path only (for example notes/idea.md). For plugin-internal paths such as /.agents/nutstore-sync/tmp or the settings file, describe them in plain words instead of quoting long absolute virtual paths.',
	'Hidden dot-folders, including /.agents and the Obsidian config folder, are plugin or application internals that the user normally cannot see in the vault file view. You may inspect them when a task requires it, but do not expose their paths or contents in replies, citations, summaries, or progress updates unless the user explicitly asks about hidden or plugin-internal files; then explain them as internal files.',
	'You may receive workspace context in <AdditionalContext> XML blocks prepended to user messages.',
	'Each block contains only the workspace fields that changed since the previous message (a delta).',
	'For changed fields, the value is the complete current state — for example, if openFiles shrinks, files no longer in the list have been closed. Silently update your understanding of the workspace; do not mention or quote the XML structure itself.',
	'When workspace context includes skills, each entry contains a skill name, description, and path. If the current task matches one, use bash to read the complete SKILL.md at that path before following its instructions. An explicit user request for a named available skill must also load it first.',
	'Treat every Skill path as an opaque absolute path: copy it exactly from workspace context and never construct, normalize, or substitute a different path from the Skill name.',
	'Paths under /.agents/skills are user-defined Vault Skills; paths under /.agents/nutstore-sync/builtin-skills are bundled built-in Skills. These namespaces are distinct and are not interchangeable.',
	'Plugin settings (filter rules, sync timing, toggles, and a few enums) are exposed as the virtual, editable file /.config/nutstore-sync/settings.json. Read it with cat, then modify it (bash with jq, or apply_patch) to configure sync for the user; each save is validated and applied. Never try to guess or fabricate credentials.',
].join('\n')

const EXPLORER_SYSTEM_PROMPT = [
	'You are a read-only explorer subagent investigating an Obsidian vault.',
	'You operate in an isolated context and cannot see the caller conversation; your only input is the task prompt.',
	'Gather evidence with available read-only vault tools. You cannot edit, create, or delete files.',
	'Base every conclusion on tool output and cite the file paths or commands that support it.',
	'When citing vault files, use their vault-relative path (for example notes/idea.md), matching the path the user sees inside the vault.',
	'Hidden dot-folders, including /.agents and the Obsidian config folder, are not normally visible to the user. Do not expose their paths or contents unless the task explicitly asks to inspect hidden or plugin-internal files.',
	'If evidence is insufficient or conflicting, say so explicitly rather than guessing.',
	'Return a concise, grounded final answer. Do not ask questions — make reasonable assumptions and note any limitations.',
].join('\n')

function createMasterAgentDefinition({
	fullAccess,
}: AgentDefinitionSettings): AgentDefinition {
	return {
		id: MASTER_AGENT_ID,
		description: 'Main conversational assistant with full vault access.',
		systemPrompt: MASTER_SYSTEM_PROMPT,
		tools: [
			'bash',
			'apply_patch',
			'view_image',
			'todowrite',
			'update_session_title',
			'task',
		],
		permissionMode: fullAccess ? 'full' : 'ask',
		dispatchable: false,
	}
}

function createExplorerAgentDefinition(): AgentDefinition {
	return {
		id: EXPLORER_AGENT_ID,
		description:
			'Read-only subagent for exploring the vault and answering questions about its contents without modifying files.',
		systemPrompt: EXPLORER_SYSTEM_PROMPT,
		tools: ['bash', 'view_image', 'task'],
		permissionMode: 'readonly',
		dispatchable: true,
	}
}

export function createAgentDefinitions(
	settings: AgentDefinitionSettings = { fullAccess: false },
) {
	return [
		createMasterAgentDefinition(settings),
		createExplorerAgentDefinition(),
	]
}

export function getAgentDefinition(
	type: string,
	settings?: AgentDefinitionSettings,
): AgentDefinition | undefined {
	return createAgentDefinitions(settings).find(
		(definition) => definition.id === type,
	)
}

export function listDispatchableDefinitions(
	settings?: AgentDefinitionSettings,
) {
	return createAgentDefinitions(settings).filter(
		(definition) => definition.dispatchable,
	)
}

export function filterToolsForAgent<T extends ToolSet>(
	tools: T,
	definition: AgentDefinition,
): T {
	const allowed = new Set(definition.tools)
	return Object.fromEntries(
		Object.entries(tools).filter(
			([name]) => allowed.has(name) || isMcpToolName(name),
		),
	) as T
}
