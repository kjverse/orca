import type { AgentSessionContinuationRequest } from '@/lib/agent-session-continuation'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'

export function canContinueAiVaultSessionInNewSession(
  session: AiVaultSession,
  targetWorktreeId: string | null | undefined
): boolean {
  return Boolean(
    targetWorktreeId &&
    (session.filePath.trim() || session.previewMessages.some((message) => message.text.trim()))
  )
}

export function prepareAiVaultSessionContinuation(args: {
  session: AiVaultSession
  targetWorktreeId: string
  targetWorkspacePath: string
}): AgentSessionContinuationRequest {
  const { session, targetWorktreeId, targetWorkspacePath } = args
  return {
    source: {
      capturedText: previewTranscript(session),
      sourceAgent: session.agent,
      sourceTitle: session.title,
      sourceWorkingDirectory: session.cwd,
      transcriptPath: session.filePath.trim() || null,
      // Why: preview user entries can be tool results or injected skill text; only provider-authenticated prompts are safe hints.
      lastPrompt: session.lastUserPrompt ?? null,
      lastAssistantMessage: latestAssistantPreview(session)
    },
    worktreeId: targetWorktreeId,
    workspacePath: targetWorkspacePath,
    // Why: sessions can outlive their worktree selection, but continuation should preserve their recorded cwd.
    initialCwd: continuationCwd(session, targetWorkspacePath),
    launchSource: 'sidebar'
  }
}

// Why: an agent reads <cwd>/.codex or <cwd>/.claude as a *project* config. Starting a continuation
// in the directory that holds the user's own one downgrades it to project scope, which silently
// drops user-level keys and re-gates already-trusted hooks, so the worktree is the safer start.
function continuationCwd(session: AiVaultSession, targetWorkspacePath: string): string {
  const recorded = session.cwd
  if (!recorded) {
    return targetWorkspacePath
  }
  return shadowsAgentConfigRoot(recorded, session.filePath, session.executionHostPlatform)
    ? targetWorkspacePath
    : recorded
}

const AGENT_CONFIG_DIRECTORY_NAMES = new Set(['.codex', '.claude'])

function shadowsAgentConfigRoot(
  cwd: string,
  transcriptPath: string,
  platform: AiVaultSession['executionHostPlatform']
): boolean {
  const configRootParent = agentConfigRootParent(transcriptPath)
  if (!configRootParent) {
    return false
  }
  const compare = (value: string): string =>
    platform === 'win32' || platform === 'darwin' ? value.toLowerCase() : value
  return compare(configRootParent) === compare(normalizeDirectory(cwd))
}

// Why: a transcript always lives under <home>/.codex or <home>/.claude, so its own path names the
// directory the config sits in without the renderer needing to resolve the host's home directory.
function agentConfigRootParent(transcriptPath: string): string | null {
  const segments = normalizeDirectory(transcriptPath).split('/')
  const configIndex = segments.findIndex((segment) => AGENT_CONFIG_DIRECTORY_NAMES.has(segment))
  return configIndex > 0 ? segments.slice(0, configIndex).join('/') : null
}

function normalizeDirectory(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function latestAssistantPreview(session: AiVaultSession): string | null {
  return session.previewMessages.findLast((message) => message.role === 'assistant')?.text ?? null
}

function previewTranscript(session: AiVaultSession): string {
  return session.previewMessages
    .filter((message) => message.text.trim())
    .map((message) => `${message.role}: ${message.text.trim()}`)
    .join('\n\n')
}
