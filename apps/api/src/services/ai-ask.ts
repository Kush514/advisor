import { ProductRequirements, RecommendationResponse as AiAskResponse } from '@vmone/shared';

export interface AiAskRequest {
  messages: { role: 'user' | 'ai'; text: string }[];
  currentRequirements?: ProductRequirements;
}

export async function processAskFlow(
  apiKey: string,
  request: AiAskRequest
): Promise<AiAskResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`;

  const systemInstruction = `You are the VM One Product Advisor. Your goal is to help users find the perfect appliance or electronic device.
We only recommend products that have been genuinely reviewed by VM One.
You must extract the user's requirements and ask DYNAMIC, CATEGORY-AWARE questions to fill in missing information.
DO NOT ask for information the user has already provided.
DO NOT ask more than ONE question at a time.
DO NOT invent products.

Categories include: TVs, Air Conditioners, Refrigerators, Washing Machines, Air Purifiers, Microwaves, Soundbars.

If the user wants a TV, useful attributes are: budget, screen size, primary usage (movies, gaming, mixed), brand preference.
If AC: budget, room size/tonnage, split/window, brand.
If Refrigerator: budget, family size/capacity, door type, brand.
If Washing Machine: budget, capacity, top/front load, brand.

When you have enough high-value information (e.g. Category + Budget + Size/Usage), set status to "ready" and provide a brief confirmation message.
If you need more info, set status to "needs_information" and ask ONE concise question.
If the user says they don't know or want to skip a requirement, leave it null/empty and move on.

You must output valid JSON matching the schema exactly.
Preserve the existing requirements if they haven't changed. Update them if the user provides new info.
`;

  // Limit history to the last 12 messages to prevent context overflow and save cost
  const limitedMessages = request.messages.slice(-12);

  // Map messages to Gemini format
  const contents = limitedMessages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: String(m.text).substring(0, 1000) }] // prevent massive user inputs
  }));

  // Append a system note about the current requirements to ground the model
  const latestReqStr = request.currentRequirements 
    ? JSON.stringify(request.currentRequirements) 
    : '{}';
    
  contents.push({
    role: 'user',
    parts: [{ 
      text: `[SYSTEM NOTE: The current structured requirements are: ${latestReqStr}. Update them based on the conversation so far. If enough info is gathered (at least category and a major constraint like budget or size), set status to "ready". Otherwise "needs_information".]`
    }]
  });

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "OBJECT",
        properties: {
          status: {
            type: "STRING",
            enum: ["needs_information", "ready"]
          },
          message: {
            type: "STRING"
          },
          requirements: {
            type: "OBJECT",
            properties: {
              category: { type: "STRING" },
              budget: {
                type: "OBJECT",
                properties: {
                  min: { type: "NUMBER" },
                  max: { type: "NUMBER" }
                }
              },
              brand: {
                type: "ARRAY",
                items: { type: "STRING" }
              },
              model: { type: "STRING" },
              features: {
                type: "ARRAY",
                items: { type: "STRING" }
              }
            }
          },
          suggested_replies: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["status", "message", "requirements", "suggested_replies"]
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API Error: ${response.status} ${err}`);
  }

  const data = await response.json() as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No text returned from Gemini');
  }

  // Safely parse JSON in case of hallucinated markdown blocks
  let cleanText = text.trim();
  if (cleanText.startsWith('```json')) {
    cleanText = cleanText.replace(/^```json/, '');
  }
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```/, '');
  }
  if (cleanText.endsWith('```')) {
    cleanText = cleanText.replace(/```$/, '');
  }
  cleanText = cleanText.trim();

  try {
    const parsed = JSON.parse(cleanText) as AiAskResponse;
    if (parsed.requirements?.budget) {
      // Normalize AI's {min, max} to canonical {kind: 'range', min, max}
      const rawBudget = parsed.requirements.budget as any;
      if (rawBudget.min !== undefined || rawBudget.max !== undefined) {
        parsed.requirements.budget = {
          kind: 'range',
          min: rawBudget.min,
          max: rawBudget.max
        };
      }
    }
    return parsed;
  } catch (parseError) {
    throw new Error(`Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
  }
}
