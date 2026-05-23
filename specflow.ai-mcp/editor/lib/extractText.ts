/**
 * Client-side text extraction utilities.
 * Supports .md / .txt, .docx (via mammoth), and .pdf (via pdfjs-dist).
 * Never runs on the server — only imported from client components.
 */

export async function extractText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'md' || ext === 'txt') {
    return readAsText(file)
  }

  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const buffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer: buffer })
    return result.value
  }

  if (ext === 'pdf') {
    return extractPdfText(file)
  }

  throw new Error(`Formato não suportado: .${ext}. Use PDF, DOCX ou MD.`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve((e.target?.result as string) ?? '')
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo'))
    reader.readAsText(file, 'UTF-8')
  })
}

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs-dist out of the SSR bundle
  const pdfjsLib = await import('pdfjs-dist')

  // Point the worker to the matching CDN build so there's no local worker bundle
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

  const pageTexts: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const text = content.items
      .map((item: unknown) => (item as { str?: string }).str ?? '')
      .join(' ')
    pageTexts.push(text)
  }

  return pageTexts.join('\n\n')
}
