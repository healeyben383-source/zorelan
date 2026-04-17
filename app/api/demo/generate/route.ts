import OpenAI from "openai";

export const runtime = "nodejs";

function getMockDraft(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("refund") || lower.includes("charge") || lower.includes("charged") || lower.includes("payment")) {
    return "Thank you for reaching out about this charge. I sincerely apologise for the inconvenience. I've reviewed your account and can confirm a full refund has been initiated — please allow 3–5 business days for it to appear. If you have any further questions, we're here to help.";
  }

  if (lower.includes("cancel") || lower.includes("subscription")) {
    return "Thank you for contacting us. I've processed your cancellation request and you will not be billed again. You'll retain access until the end of your current billing period. Please let us know if there's anything else we can do for you.";
  }

  if (lower.includes("password") || lower.includes("login") || lower.includes("account") || lower.includes("access")) {
    return "Thank you for getting in touch. I can help you regain access to your account. I've sent a password reset link to the email address on file — please check your inbox and follow the instructions. If you don't receive it within a few minutes, check your spam folder or reply here.";
  }

  return "Thank you for reaching out. I'm sorry to hear you're experiencing this issue. I've looked into your account and our team is working to resolve this as quickly as possible. We'll follow up with you within one business day. Thank you for your patience.";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const message = body?.message;

  if (!message || typeof message !== "string") {
    return Response.json({ error: "Missing or invalid message" }, { status: 400 });
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "You are a customer support agent. Write a concise, professional response to the customer's message. Keep it under 100 words."
          },
          { role: "user", content: message }
        ]
      });

      const draft = response.choices[0]?.message?.content;
      if (draft) return Response.json({ draft });
    } catch (error) {
      console.error("OpenAI call failed, using mock draft:", error);
    }
  }

  return Response.json({ draft: getMockDraft(message) });
}
