import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { judgeSemanticAgreement } from "../lib/synthesis/semanticAgreement";

const cases = [
  {
    name: "Earth factual agreement",
    question: "Is Earth a planet?",
    answerA: "Earth is a planet and the third planet from the Sun.",
    answerB: "Earth is indeed a planet in our solar system.",
    expected: "HIGH_AGREEMENT",
  },
  {
    name: "Photosynthesis paraphrase",
    question: "What is photosynthesis?",
    answerA:
      "Photosynthesis is the process plants use to convert sunlight, water, and carbon dioxide into glucose and oxygen.",
    answerB:
      "Plants make food through photosynthesis by using light energy to turn water and carbon dioxide into sugars, releasing oxygen.",
    expected: "HIGH_AGREEMENT",
  },
  {
    name: "Exercise with caveats",
    question: "Should I exercise daily?",
    answerA: "Exercise daily can be beneficial, but recovery matters and intensity should vary.",
    answerB: "Daily exercise is fine if intensity is managed and rest is built in.",
    expected: "MEDIUM_AGREEMENT",
  },
  {
    name: "Direct contradiction",
    question: "Should I do it?",
    answerA: "Yes, you should do it.",
    answerB: "No, you should not do it.",
    expected: "CONFLICT",
  },
  {
    name: "Conditional alignment",
    question: "Will this always work?",
    answerA: "It depends on the situation.",
    answerB: "It depends; the answer varies by context.",
    expected: "MEDIUM_AGREEMENT",
  },
  {
    name: "Firewall explanation",
    question: "What does a firewall do?",
    answerA: "A firewall filters network traffic.",
    answerB: "A firewall monitors traffic and blocks unauthorized access.",
    expected: "HIGH_AGREEMENT",
  },
] as const;

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY");
    process.exit(1);
  }

  console.log("\nSemantic agreement judge test run\n");

  let passCount = 0;

  for (const testCase of cases) {
    try {
      const result = await judgeSemanticAgreement({
        question: testCase.question,
        answerA: testCase.answerA,
        answerB: testCase.answerB,
      });

      const passed = result.label === testCase.expected;
      if (passed) passCount += 1;

      console.log(`${passed ? "✅" : "❌"} ${testCase.name}`);
      console.log(`   expected: ${testCase.expected}`);
      console.log(`   actual:   ${result.label}`);
      console.log(`   mapped:   agreement=${result.agreementLevel}, conflict=${result.likelyConflict}`);
      console.log(`   reason:   ${result.rationale}`);
      console.log("");
    } catch (error) {
      console.log(`❌ ${testCase.name}`);
      console.log(`   error: ${error instanceof Error ? error.message : String(error)}`);
      console.log("");
    }
  }

  console.log(`Passed ${passCount}/${cases.length} cases.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
