import { NextRequest, NextResponse } from 'next/server'

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:3001/mcp'

// document_ingest can take a while: LLM chunking + N embedding calls.
// Use a 120-second timeout so large documents don't time out.
const INGEST_TIMEOUT_MS = 120_000

interface IngestBody {
  document_id: string
  raw_text: string
  origin?: string
}

export async function POST(req: NextRequest) {
  let body: IngestBody
  try {
    body = (await req.json()) as IngestBody
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })
  }

  const { document_id, raw_text, origin = 'rascunho' } = body

  if (!document_id || !raw_text?.trim()) {
    return NextResponse.json(
      { error: 'document_id e raw_text são obrigatórios' },
      { status: 400 }
    )
  }

  // Forward to the MCP server's document_ingest tool
  let mcpRes: Response
  try {
    mcpRes = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'document_ingest',
          arguments: { document_id, raw_text, origin },
        },
        id: Date.now(),
      }),
      signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Servidor MCP inacessível: ${msg}` },
      { status: 502 }
    )
  }

  // Parse the MCP response — may be JSON or SSE
  let payload: unknown
  const contentType = mcpRes.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    const text = await mcpRes.text()
    const dataLine = text.split('\n').find(l => l.startsWith('data: '))
    if (!dataLine) {
      return NextResponse.json({ error: 'Resposta SSE do MCP sem linha data:' }, { status: 502 })
    }
    try {
      payload = JSON.parse(dataLine.slice(6))
    } catch {
      return NextResponse.json({ error: 'Falha ao parsear SSE do MCP' }, { status: 502 })
    }
  } else {
    payload = await mcpRes.json()
  }

  const typed = payload as {
    error?: { message?: string }
    result?: { content?: { text: string }[] }
  }

  if (typed.error) {
    return NextResponse.json(
      { error: typed.error.message ?? JSON.stringify(typed.error) },
      { status: 422 }
    )
  }

  const text = typed.result?.content?.[0]?.text
  if (!text) {
    return NextResponse.json({ error: 'Resposta MCP inesperada' }, { status: 502 })
  }

  try {
    const result = JSON.parse(text)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Resultado do MCP não é JSON válido' }, { status: 502 })
  }
}
