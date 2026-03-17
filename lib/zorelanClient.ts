import { Zorelan } from "../sdk/dist/index.js";

const apiKey = process.env.DECISION_API_KEY;

if (!apiKey) {
  throw new Error("Missing DECISION_API_KEY environment variable");
}

export const zorelan = new Zorelan(apiKey);