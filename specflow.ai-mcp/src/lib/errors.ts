export class McpError extends Error {
  constructor(
    message: string,
    public readonly code: string = "INTERNAL_ERROR"
  ) {
    super(message);
    this.name = "McpError";
  }
}

export function toErrorContent(err: unknown): string {
  if (err instanceof McpError) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
