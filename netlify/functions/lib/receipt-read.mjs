/**
 * Receipt photo → shop, date, euro total.
 * Calls the xAI responses API (image understanding). The key stays on the server.
 * Normalization of the JSON is the pure model in tracker/js/models/receipt.js.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { normalizeReceiptRead } = require("../../../tracker/js/models/receipt.js");

export const RECEIPT_MODEL = "grok-4.7";

const PROMPT = [
  "This is one shop receipt or invoice photo, usually from Spain (euros, day before month).",
  "Read only what is printed.",
  "vendor: the shop or merchant name, short, as printed. Empty string if you cannot see it.",
  "date: the receipt date as YYYY-MM-DD. Empty string if there is no readable date.",
  "When the slip is European, the day is first: 12/09/2026 is 12 September 2026.",
  "amount: the final amount paid, as a number. Use TOTAL, IMPORTE, TOTAL A PAGAR, or the card charge.",
  "Do not use a line item, the VAT-only line, the change, or a subtotal when a larger total is printed.",
  "null if you are not sure which number is the total.",
  "currency: EUR when the slip is in euros or shows €, or when a Spanish till shows no currency.",
  "Otherwise the currency code. Empty if unknown.",
].join(" ");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    vendor: { type: "string" },
    date: { type: "string" },
    amount: { type: ["number", "null"] },
    currency: { type: "string" },
  },
  required: ["vendor", "date", "amount", "currency"],
};

export function failReceipt(status, error) {
  const err = new Error(error);
  err.status = status;
  return err;
}

/** Pull the model's text out of a responses (or chat) body. */
export function textFromXaiResponse(body) {
  if (!body || typeof body !== "object") return "";
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const out = Array.isArray(body.output) ? body.output : [];
  for (let i = 0; i < out.length; i++) {
    const item = out[i];
    if (!item) continue;
    if (typeof item === "string") return item;
    if (item.type === "output_text" && typeof item.text === "string") return item.text;
    const content = item.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    for (let j = 0; j < content.length; j++) {
      const c = content[j];
      if (!c) continue;
      if (typeof c.text === "string" && (c.type === "output_text" || c.type === "text" || !c.type)) return c.text;
    }
  }
  const choice = body.choices && body.choices[0] && body.choices[0].message;
  if (choice && typeof choice.content === "string") return choice.content;
  return "";
}

export function rawFromReceiptText(text) {
  let s = String(text || "").trim();
  if (!s) return null;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function assertImage(image) {
  const s = String(image || "");
  if (!/^data:image\/(jpeg|jpg|png);base64,/i.test(s)) {
    throw failReceipt(400, "Send a JPEG or PNG receipt photo");
  }
  if (s.length > 4000000) {
    throw failReceipt(413, "Photo is too large to read — crop closer and try again");
  }
  return s;
}

/**
 * @param {{ image: string, apiKey?: string, fetchImpl?: typeof fetch, today?: string, model?: string }} opts
 */
export async function readReceiptImage(opts) {
  opts = opts || {};
  const image = assertImage(opts.image);
  const apiKey = String(opts.apiKey || "");
  if (!apiKey) throw failReceipt(503, "Receipt reading is not configured");
  const fetchImpl = opts.fetchImpl || fetch;
  const model = opts.model || RECEIPT_MODEL;
  let res;
  try {
    res = await fetchImpl("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: image, detail: "high" },
              { type: "input_text", text: PROMPT },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "receipt_read",
            strict: true,
            schema: SCHEMA,
          },
        },
      }),
    });
  } catch (e) {
    throw failReceipt(502, "Could not reach the receipt reader");
  }
  const rawText = await res.text();
  if (!res.ok) {
    throw failReceipt(502, "Could not read the receipt");
  }
  let body;
  try {
    body = JSON.parse(rawText);
  } catch (e) {
    throw failReceipt(502, "Could not read the receipt");
  }
  const parsed = rawFromReceiptText(textFromXaiResponse(body));
  if (!parsed) throw failReceipt(502, "Could not read the receipt");
  return normalizeReceiptRead(parsed, opts.today);
}
