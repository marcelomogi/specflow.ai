import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3001/mcp'

export async function POST(req: NextRequest) {
  const { document_id } = await req.json()

  if (!document_id) {
    return NextResponse.json({ error: 'document_id é obrigatório' }, { status: 400 })
  }

  // Forward to MCP tool
  let mcpRes: Response
  try {
    mcpRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'improve_rationale', arguments: { document_id } },
        id: Date.now(),
      }),
    })
  } catch {
    return NextResponse.json({ error: 'Servidor MCP offline.' }, { status: 502 })
  }

  // Parse MCP response (JSON or SSE)
  const contentType = mcpRes.headers.get('content-type') ?? ''
  let data: unknown

  if (contentType.includes('text/event-stream')) {
    const text = await mcpRes.text()
    const dataLine = text.split('\n').find(l => l.startsWith('data: '))
    if (!dataLine) return NextResponse.json({ error: 'Resposta SSE inválida do MCP.' }, { status: 502 })
    data = JSON.parse(dataLine.slice(6))
  } else {
    data = await mcpRes.json()
  }

  const payload = data as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: { text: string }[] }
  }

  // JSON-RPC level error
  if (payload.error) {
    const msg = payload.error.message ?? JSON.stringify(payload.error)
    const status = msg.includes('Adicione') ? 422 : 502
    return NextResponse.json({ error: msg }, { status })
  }

  const text = payload.result?.content?.[0]?.text
  if (!text) return NextResponse.json({ error: 'Resposta MCP inesperada.' }, { status: 502 })

  // Tool-level error: result.isError = true, text is a plain error string (not JSON)
  if (payload.result?.isError) {
    const status = text.includes('Adicione') ? 422 : 502
    return NextResponse.json({ error: text }, { status })
  }

  const { rationale } = JSON.parse(text) as { rationale: string }
  return NextResponse.json({ rationale })
}
