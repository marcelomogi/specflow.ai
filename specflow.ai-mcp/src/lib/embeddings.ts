import OpenAI from "openai";

let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY environment variable");
  _openai = new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return _openai;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const model =
    process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
  const response = await getOpenAI().embeddings.create({
    model,
    input: text.replace(/\n/g, " "),
    dimensions: 1536,
  });
  return response.data[0].embedding;
}
