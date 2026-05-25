import { NextRequest, NextResponse } from 'next/server'

// Server-side only — never exposed to the browser bundle.
// In Railway: set MCP_URL to the internal URL (http://specflowai.railway.internal:8080/mcp)
// or the public URL (https://specflow-mcp-production.up.railway.app/mcp)
// Locally: http://localhost:3001/mcp
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3001/mcp'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { message: 'Invalid request body' } }, { status: 400 })
  }

  console.log('[/api/mcp] forwarding to', MCP_URL)

  // req.signal: aborts the upstream fetch when the browser disconnects or times out.
  let mcpRes: Response
  try {
    mcpRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[/api/mcp] fetch failed →', MCP_URL, '|', msg)
    return NextResponse.json(
      { error: { message: `MCP server unreachable: ${msg}` } },
      { status: 502 },
    )
  }

  const contentType = mcpRes.headers.get('content-type') ?? ''

  // The MCP SDK (StreamableHTTPServerTransport) responds with text/event-stream.
  // Streaming it directly to the browser causes buffering issues in Railway's Nginx:
  // the response is only forwarded after the upstream closes the connection, which
  // can take several seconds even after the result has been sent.
  //
  // Solution: buffer the full SSE body here on the server, extract the JSON-RPC
  // payload from the first `data:` line, and return plain JSON to the browser.
  // This eliminates the streaming dependency entirely.
  if (contentType.includes('text/event-stream')) {
    let text: string
    try {
      text = await mcpRes.text()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[/api/mcp] SSE body read failed:', msg)
      return NextResponse.json(
        { error: { message: `Failed to read MCP SSE response: ${msg}` } },
        { status: 502 },
      )
    }

    const dataLine = text.split('\n').find(l => l.startsWith('data: '))
    if (!dataLine) {
      console.error('[/api/mcp] SSE has no data: line. Raw body:', text.slice(0, 300))
      return NextResponse.json(
        { error: { message: 'MCP SSE response contained no data line' } },
        { status: 502 },
      )
    }

    try {
      const parsed = JSON.parse(dataLine.slice(6)) // strip "data: "
      return NextResponse.json(parsed, { status: mcpRes.status })
    } catch {
      console.error('[/api/mcp] Failed to parse SSE data line:', dataLine.slice(0, 300))
      return NextResponse.json(
        { error: { message: 'Failed to parse MCP SSE payload as JSON' } },
        { status: 502 },
      )
    }
  }

  // Plain JSON response — forward as-is
  const data = await mcpRes.json()
  return NextResponse.json(data, { status: mcpRes.status })
}
