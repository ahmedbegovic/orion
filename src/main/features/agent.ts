import { BrowserWindow, dialog } from 'electron'
import { handle } from '../ipc/router'
import type { AgentService } from '../services/agent-service'

/** Registers every agent.* and memory.* IPC method. */
export function registerAgentFeature(agent: AgentService): void {
  handle('agent.sessions', () => ({ sessions: agent.sessions() }))

  handle('agent.create', async ({ directory, tier }) => ({
    session: await agent.create(directory, tier)
  }))

  handle('agent.get', ({ sessionId }) => agent.get(sessionId))

  handle('agent.prompt', async ({ sessionId, text, tier }) => {
    await agent.prompt(sessionId, text, tier)
    return { ok: true }
  })

  handle('agent.abort', async ({ sessionId }) => {
    await agent.abort(sessionId)
    return { ok: true }
  })

  handle('agent.permissionReply', async ({ sessionId, permissionId, reply }) => {
    await agent.permissionReply(sessionId, permissionId, reply)
    return { ok: true }
  })

  handle('agent.delete', async ({ sessionId }) => {
    await agent.delete(sessionId)
    return { ok: true }
  })

  handle('agent.pickDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })

  handle('memory.list', () => ({ files: agent.memoryList() }))

  handle('memory.read', ({ name }) => ({ content: agent.memoryRead(name) }))

  handle('memory.write', ({ name, content }) => {
    agent.memoryWrite(name, content)
    return { ok: true }
  })
}
