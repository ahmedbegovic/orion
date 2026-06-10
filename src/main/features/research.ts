import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { handle } from '../ipc/router'
import type { ResearchOrchestrator } from '../services/research-orchestrator'

/** Registers every research.* IPC method. */
export function registerResearchFeature(orchestrator: ResearchOrchestrator): void {
  handle('research.start', (input) => orchestrator.start(input))

  handle('research.list', () => ({ runs: orchestrator.list() }))

  handle('research.get', ({ runId }) => orchestrator.get(runId))

  handle('research.cancel', ({ runId }) => ({ ok: orchestrator.cancel(runId) }))

  handle('research.resume', ({ runId }) => ({ ok: orchestrator.resume(runId) }))

  handle('research.delete', ({ runId }) => {
    orchestrator.delete(runId)
    return { ok: true }
  })

  handle('research.report', ({ runId }) => {
    const htmlPath = orchestrator.reportPath(runId)
    if (!htmlPath || !existsSync(htmlPath)) return { html: null, report: null }
    const html = readFileSync(htmlPath, 'utf8')
    let report: unknown = null
    try {
      report = JSON.parse(readFileSync(join(dirname(htmlPath), 'report.json'), 'utf8'))
    } catch {
      // report.json missing or corrupt — the html alone is still renderable
    }
    return { html, report }
  })

  handle('research.exportPdf', async ({ runId }) => {
    const htmlPath = orchestrator.reportPath(runId)
    if (!htmlPath || !existsSync(htmlPath)) return { path: null }
    // Offscreen window: the template embeds no scripts or external resources,
    // so this is a pure layout pass for printToPDF.
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    try {
      await win.loadFile(htmlPath)
      const pdf = await win.webContents.printToPDF({ printBackground: true })
      const pdfPath = join(dirname(htmlPath), 'report.pdf')
      writeFileSync(pdfPath, pdf)
      shell.showItemInFolder(pdfPath)
      return { path: pdfPath }
    } finally {
      win.destroy()
    }
  })
}
