import { NextRequest, NextResponse } from 'next/server'

// Server-side only — never exposed to the browser bundle.
// In Railway: set MCP_URL to the internal URL  (e.g. https://specflowai.railway.internal/mcp)
// Locally: http://localhost:3001/mcp
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3001/mcp'

// relation_detect can take up to 30 s (LLM classification).
// ingest can take up to 120 s. Use the larger ceiling.
const PROXY_TIMEOUT_MS = 125_000

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { message: 'Invalid request body' } }, { status: 400 })
  }

  let mcpRes: Response
  try {
    mcpRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: { message: `MCP server unreachable: ${msg}` } },
      { status: 502 },
    )
  }

  const contentType = mcpRes.headers.get('content-type') ?? ''

  // SSE response — buffer the full text and re-send with the correct content-type
  // so the client-side parseMcpResponse can handle it exactly as before.
  if (contentType.includes('text/event-stream')) {
    const text = await mcpRes.text()
    return new NextResponse(text, {
      status: mcpRes.status,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  // Regular JSON response — forward as-is
  const data = await mcpRes.json()
  return NextResponse.json(data, { status: mcpRes.status })
}
