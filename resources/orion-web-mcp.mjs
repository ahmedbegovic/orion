#!/usr/bin/env node
// Stdio MCP server proxying web search/visit to the Orion tools sidecar.
// Spawned by opencode (config mcp['orion-web']); ORION_TOOLS_URL carries the
// sidecar base url. Standalone on purpose: plain Node ESM, no imports from
// src/ — bare specifiers resolve against the adjacent node_modules.
// stdout is the protocol channel — never write anything else to it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const FETCH_TIMEOUT_MS = 60_000

async function toolsPost(path, body) {
  const base = process.env.ORION_TOOLS_URL
  if (!base) throw new Error('ORION_TOOLS_URL is not set')
  const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`tools POST ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

const textResult = (text) => ({ content: [{ type: 'text', text }] })
const errorResult = (err) => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }]
})

const server = new McpServer({ name: 'orion-web', version: '0.1.0' })

server.registerTool(
  'web_search',
  {
    description: 'Search the web. Returns result titles, urls and snippets.',
    inputSchema: {
      query: z.string().describe('The search query'),
      max_results: z.number().int().min(1).max(20).optional().describe('Maximum results (default 8)')
    }
  },
  async ({ query, max_results }) => {
    try {
      // → routers/web.py SearchRequest; response {results: [{title, url, snippet}], backend}
      const body = { query }
      if (max_results !== undefined) body.max_results = max_results
      const { results } = await toolsPost('/search', body)
      if (results.length === 0) return textResult('No results.')
      return textResult(
        results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
          .join('\n\n')
      )
    } catch (err) {
      return errorResult(err)
    }
  }
)

server.registerTool(
  'web_visit',
  {
    description: 'Fetch a web page and return its main content as markdown.',
    inputSchema: {
      url: z.string().describe('Absolute http(s) url of the page to read')
    }
  },
  async ({ url }) => {
    try {
      // → routers/web.py VisitRequest (sidecar truncates at its max_chars
      // default); response {markdown, title, url}
      const page = await toolsPost('/visit', { url })
      const heading = page.title ? `# ${page.title}\n\n` : ''
      return textResult(`${heading}${page.markdown}\n\nSource: ${page.url}`)
    } catch (err) {
      return errorResult(err)
    }
  }
)

try {
  await server.connect(new StdioServerTransport())
} catch (err) {
  console.error(`orion-web-mcp failed to start: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
