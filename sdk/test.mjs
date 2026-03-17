import { Zorelan } from "./dist/index.js";

const zorelan = new Zorelan(process.env.ZORELAN_API_KEY);

const result = await zorelan.verify("Is Earth a planet?");

console.log("ANSWER:", result.verified_answer);
console.log("TRUST:", result.trust_score.score);
console.log("CONSENSUS:", result.consensus.level);