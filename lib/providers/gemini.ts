import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set");
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const DEFAULT_SYSTEM = `You are a thorough and insightful AI assistant. 
Always provide detailed, well-structured responses. 
Never give one-line answers. 
Break your response into clear sections where appropriate. 
Aim for depth, nuance, and practical value in every response.`;

type GeminiRunParams = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
};

export async function runGemini({
  prompt,
  system = DEFAULT_SYSTEM,
  temperature = 0.4,
  maxTokens = 1200,
}: GeminiRunParams): Promise<string> {
  if (!genAI) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const modelName = "gemini-1.5-flash-latest";

  try {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: system,
    });

    const runRequest = async (): Promise<string> => {
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      });

      const text = result.response.text()?.trim();
      return text || "";
    };

    const firstText = await runRequest();

    if (firstText) {
      return firstText;
    }

    console.warn("[GEMINI] Empty response on first attempt, retrying once...");

    const secondText = await runRequest();

    if (secondText) {
      return secondText;
    }

    throw new Error("Gemini returned empty output after retry");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Gemini error";

    throw new Error(`Gemini provider failed [${modelName}]: ${message}`);
  }
}
