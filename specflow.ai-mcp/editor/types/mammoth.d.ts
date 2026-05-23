declare module 'mammoth' {
  interface ConversionResult {
    value: string
    messages: unknown[]
  }

  interface ExtractRawTextOptions {
    arrayBuffer?: ArrayBuffer
    path?: string
    buffer?: Buffer
  }

  function extractRawText(options: ExtractRawTextOptions): Promise<ConversionResult>
  function convertToHtml(options: ExtractRawTextOptions): Promise<ConversionResult>
}
