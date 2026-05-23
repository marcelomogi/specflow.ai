import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY environment variable");
  _client = new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
  });
  return _client;
}

/**
 * Send a chat completion request to OpenRouter.
 * Returns the raw text content of the first choice.
 */
export async function callLLM(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const model =
    process.env.OPENROUTER_LLM_MODEL ?? "openai/gpt-4o-mini";

  const response = await getClient().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
  });

  return response.choices[0]?.message?.content ?? "";
}
