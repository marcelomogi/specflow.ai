import { NextRequest, NextResponse } from 'next/server'

// Server-side only — never exposed to the browser bundle.
// In Railway: set MCP_URL to the internal URL (e.g. http://specflowai.railway.internal:8080/mcp)
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

  // Forward the client's abort signal so if the browser times out,
  // the upstream request is cancelled immediately.
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

  const contentType = mcpRes.headers.get('content-type') ?? 'application/json'

  // Stream the body directly — never buffer.
  // Works for both JSON and SSE; the client-side parseMcpResponse handles either.
  return new NextResponse(mcpRes.body, {
    status: mcpRes.status,
    headers: { 'Content-Type': contentType },
  })
}
