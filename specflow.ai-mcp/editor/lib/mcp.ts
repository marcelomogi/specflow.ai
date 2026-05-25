const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp'

export class McpOfflineError extends Error {
  constructor() {
    super('Servidor MCP offline')
    this.name = 'McpOfflineError'
  }
}

/** Parse the MCP response regardless of whether the server chose JSON or SSE. */
async function parseMcpResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    // SSE format:
    //   event: message
    //   data: {"jsonrpc":"2.0","id":1,"result":{...}}
    //   (blank line)
    const text = await res.text()
    const dataLine = text
      .split('\n')
      .find(line => line.startsWith('data: '))
    if (!dataLine) throw new Error('Resposta SSE do MCP não contém linha data:')
    return JSON.parse(dataLine.slice(6)) // strip "data: "
  }

  return res.json()
}

export async function callMCP<T = unknown>(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Both accepted so the server can choose — parseMcpResponse handles either
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: tool, arguments: args },
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new McpOfflineError()
  }

  const data = await parseMcpResponse(res)
  const payload = data as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: { text: string }[] }
  }

  // JSON-RPC level error
  if (payload.error) {
    throw new Error(payload.error.message ?? JSON.stringify(payload.error))
  }

  const text = payload.result?.content?.[0]?.text
  if (text === undefined) throw new Error('Resposta MCP inesperada: ' + JSON.stringify(data))

  // Tool-level error: isError = true, text is plain string not JSON
  if (payload.result?.isError) {
    throw new Error(text)
  }

  return JSON.parse(text) as T
}
