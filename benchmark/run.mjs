import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://zorelan.com";
const DELAY_MS = 4000;
const OUTPUT_FILE = path.join(__dirname, "results.json");

const QUESTIONS = [
  // Factual — expect HIGH agreement, trust score 75+
  { id: 1, prompt: "What is the capital of Australia?", category: "factual", expectedAgreement: "high" },
  { id: 2, prompt: "How many planets are in the solar system?", category: "factual", expectedAgreement: "high" },
  { id: 3, prompt: "What year did World War II end?", category: "factual", expectedAgreement: "high" },
  { id: 4, prompt: "What is the speed of light?", category: "factual", expectedAgreement: "high" },
  { id: 5, prompt: "What is the chemical formula for water?", category: "factual", expectedAgreement: "high" },
  { id: 6, prompt: "Who wrote Romeo and Juliet?", category: "factual", expectedAgreement: "high" },
  { id: 7, prompt: "What is the largest ocean on Earth?", category: "factual", expectedAgreement: "high" },
  { id: 8, prompt: "What language is most spoken in Brazil?", category: "factual", expectedAgreement: "high" },
  { id: 9, prompt: "What is the boiling point of water at sea level?", category: "factual", expectedAgreement: "high" },
  { id: 10, prompt: "What is the powerhouse of the cell?", category: "factual", expectedAgreement: "high" },
  { id: 11, prompt: "How many sides does a hexagon have?", category: "factual", expectedAgreement: "high" },
  { id: 12, prompt: "What is the square root of 144?", category: "factual", expectedAgreement: "high" },
  { id: 13, prompt: "What continent is Egypt in?", category: "factual", expectedAgreement: "high" },
  { id: 14, prompt: "What gas do plants absorb during photosynthesis?", category: "factual", expectedAgreement: "high" },
  { id: 15, prompt: "What is the currency of Japan?", category: "factual", expectedAgreement: "high" },
  { id: 16, prompt: "How many bones are in the adult human body?", category: "factual", expectedAgreement: "high" },
  { id: 17, prompt: "What is the tallest mountain in the world?", category: "factual", expectedAgreement: "high" },
  { id: 18, prompt: "What programming language was created by Guido van Rossum?", category: "factual", expectedAgreement: "high" },
  { id: 19, prompt: "What is the atomic number of carbon?", category: "factual", expectedAgreement: "high" },
  { id: 20, prompt: "What year was the first iPhone released?", category: "factual", expectedAgreement: "high" },

  // Strategy — expect MEDIUM agreement, trust score 55-75
  { id: 21, prompt: "Should a startup focus on growth or profitability in its first year?", category: "strategy", expectedAgreement: "medium" },
  { id: 22, prompt: "Is it better to build a product for a niche market or a broad market?", category: "strategy", expectedAgreement: "medium" },
  { id: 23, prompt: "Should founders take a salary in the early stages of a startup?", category: "strategy", expectedAgreement: "medium" },
  { id: 24, prompt: "What is the best way to validate a startup idea before building?", category: "strategy", expectedAgreement: "medium" },
  { id: 25, prompt: "Should a new business prioritise customer acquisition or customer retention?", category: "strategy", expectedAgreement: "medium" },
  { id: 26, prompt: "Is it better to launch a product early with fewer features or wait until it is polished?", category: "strategy", expectedAgreement: "medium" },
  { id: 27, prompt: "Should a software company charge monthly or annually for subscriptions?", category: "strategy", expectedAgreement: "medium" },
  { id: 28, prompt: "When should a startup hire its first sales person?", category: "strategy", expectedAgreement: "medium" },
  { id: 29, prompt: "Is it better to raise venture capital early or bootstrap as long as possible?", category: "strategy", expectedAgreement: "medium" },
  { id: 30, prompt: "Should a founder be a generalist or hire specialists early?", category: "strategy", expectedAgreement: "medium" },

  // Technical — expect HIGH agreement on best practices
  { id: 31, prompt: "What is the difference between REST and GraphQL?", category: "technical", expectedAgreement: "high" },
  { id: 32, prompt: "When should you use a SQL database versus a NoSQL database?", category: "technical", expectedAgreement: "medium" },
  { id: 33, prompt: "What is the purpose of a Docker container?", category: "technical", expectedAgreement: "high" },
  { id: 34, prompt: "What is the difference between authentication and authorisation?", category: "technical", expectedAgreement: "high" },
  { id: 35, prompt: "What is a race condition in software development?", category: "technical", expectedAgreement: "high" },
  { id: 36, prompt: "When should you use TypeScript instead of JavaScript?", category: "technical", expectedAgreement: "medium" },
  { id: 37, prompt: "What is the CAP theorem?", category: "technical", expectedAgreement: "high" },
  { id: 38, prompt: "What is the difference between a process and a thread?", category: "technical", expectedAgreement: "high" },
  { id: 39, prompt: "What is a webhook and how does it differ from polling?", category: "technical", expectedAgreement: "high" },
  { id: 40, prompt: "Should you use server side rendering or client side rendering for a web app?", category: "technical", expectedAgreement: "medium" },
  { id: 41, prompt: "What is the purpose of an index in a database?", category: "technical", expectedAgreement: "high" },
  { id: 42, prompt: "What is the difference between TCP and UDP?", category: "technical", expectedAgreement: "high" },
  { id: 43, prompt: "What is a memory leak and how do you prevent it?", category: "technical", expectedAgreement: "high" },
  { id: 44, prompt: "What is the difference between horizontal and vertical scaling?", category: "technical", expectedAgreement: "high" },
  { id: 45, prompt: "When should you use caching in an application?", category: "technical", expectedAgreement: "medium" },

  // Nuanced — expect MEDIUM to LOW agreement
  { id: 46, prompt: "Is working from home better than working from an office?", category: "nuanced", expectedAgreement: "medium" },
  { id: 47, prompt: "Should companies prioritise diversity hiring?", category: "nuanced", expectedAgreement: "medium" },
  { id: 48, prompt: "Is a university degree worth it in 2025?", category: "nuanced", expectedAgreement: "medium" },
  { id: 49, prompt: "Should social media platforms moderate political content?", category: "nuanced", expectedAgreement: "low" },
  { id: 50, prompt: "Is it ethical for companies to use AI to screen job applicants?", category: "nuanced", expectedAgreement: "medium" },
  { id: 51, prompt: "Should governments regulate cryptocurrency?", category: "nuanced", expectedAgreement: "medium" },
  { id: 52, prompt: "Is it better to rent or buy a home?", category: "nuanced", expectedAgreement: "medium" },
  { id: 53, prompt: "Should AI generated content be labelled?", category: "nuanced", expectedAgreement: "medium" },
  { id: 54, prompt: "Is it ethical to use animals in medical research?", category: "nuanced", expectedAgreement: "medium" },
  { id: 55, prompt: "Should remote workers be paid differently based on where they live?", category: "nuanced", expectedAgreement: "medium" },

  // Controversial — expect LOW agreement or CONFLICT
  { id: 56, prompt: "Is capitalism the best economic system?", category: "controversial", expectedAgreement: "low" },
  { id: 57, prompt: "Should the death penalty be abolished?", category: "controversial", expectedAgreement: "low" },
  { id: 58, prompt: "Is nuclear energy safe?", category: "controversial", expectedAgreement: "medium" },
  { id: 59, prompt: "Should the voting age be lowered to 16?", category: "controversial", expectedAgreement: "low" },
  { id: 60, prompt: "Is social media doing more harm than good to society?", category: "controversial", expectedAgreement: "medium" },

  // Developer use cases — the real target market
  { id: 61, prompt: "What is the best way to handle errors in a Node.js API?", category: "developer", expectedAgreement: "high" },
  { id: 62, prompt: "Should you write unit tests or integration tests first?", category: "developer", expectedAgreement: "medium" },
  { id: 63, prompt: "What is the best way to store passwords in a database?", category: "developer", expectedAgreement: "high" },
  { id: 64, prompt: "When should you use a microservices architecture?", category: "developer", expectedAgreement: "medium" },
  { id: 65, prompt: "What is the best way to handle API rate limiting?", category: "developer", expectedAgreement: "high" },
  { id: 66, prompt: "Should you use an ORM or write raw SQL queries?", category: "developer", expectedAgreement: "medium" },
  { id: 67, prompt: "What is the best way to structure a React application?", category: "developer", expectedAgreement: "medium" },
  { id: 68, prompt: "When should you use Redis versus a relational database?", category: "developer", expectedAgreement: "medium" },
  { id: 69, prompt: "What is the best way to implement authentication in a web app?", category: "developer", expectedAgreement: "medium" },
  { id: 70, prompt: "Should you use a monorepo or separate repositories for microservices?", category: "developer", expectedAgreement: "medium" },
  { id: 71, prompt: "What is the best way to handle database migrations?", category: "developer", expectedAgreement: "medium" },
  { id: 72, prompt: "When should you use a message queue?", category: "developer", expectedAgreement: "medium" },
  { id: 73, prompt: "What is the best way to implement logging in a production application?", category: "developer", expectedAgreement: "high" },
  { id: 74, prompt: "Should you use server side sessions or JWTs for authentication?", category: "developer", expectedAgreement: "medium" },
  { id: 75, prompt: "What is the best way to optimise a slow database query?", category: "developer", expectedAgreement: "high" },
  { id: 76, prompt: "When should you use WebSockets versus HTTP?", category: "developer", expectedAgreement: "high" },
  { id: 77, prompt: "What is the best way to handle file uploads in a web application?", category: "developer", expectedAgreement: "high" },
  { id: 78, prompt: "Should you use Kubernetes for a small startup?", category: "developer", expectedAgreement: "medium" },
  { id: 79, prompt: "What is the best way to implement search in a web application?", category: "developer", expectedAgreement: "medium" },
  { id: 80, prompt: "When should you use a CDN?", category: "developer", expectedAgreement: "high" },

  // Medical and scientific — high stakes, expect high agreement on consensus
  { id: 81, prompt: "Is intermittent fasting effective for weight loss?", category: "health", expectedAgreement: "medium" },
  { id: 82, prompt: "What are the health risks of smoking?", category: "health", expectedAgreement: "high" },
  { id: 83, prompt: "Is exercise effective for treating mild depression?", category: "health", expectedAgreement: "high" },
  { id: 84, prompt: "What is the recommended amount of sleep for adults?", category: "health", expectedAgreement: "high" },
  { id: 85, prompt: "Are vaccines safe?", category: "health", expectedAgreement: "high" },

  // Finance — real decisions people make
  { id: 86, prompt: "Should you pay off debt or invest first?", category: "finance", expectedAgreement: "medium" },
  { id: 87, prompt: "Is index fund investing better than stock picking?", category: "finance", expectedAgreement: "medium" },
  { id: 88, prompt: "What is the best age to start saving for retirement?", category: "finance", expectedAgreement: "high" },
  { id: 89, prompt: "Should you have an emergency fund before investing?", category: "finance", expectedAgreement: "high" },
  { id: 90, prompt: "Is Bitcoin a good long term investment?", category: "finance", expectedAgreement: "low" },

  // Edge cases — testing the system's limits
  { id: 91, prompt: "What is the meaning of life?", category: "edge", expectedAgreement: "low" },
  { id: 92, prompt: "Is time travel theoretically possible?", category: "edge", expectedAgreement: "medium" },
  { id: 93, prompt: "Will artificial intelligence replace most jobs in the next 20 years?", category: "edge", expectedAgreement: "medium" },
  { id: 94, prompt: "Is consciousness purely a product of the brain?", category: "edge", expectedAgreement: "low" },
  { id: 95, prompt: "What is the best programming language to learn first?", category: "edge", expectedAgreement: "medium" },
  { id: 96, prompt: "Should you follow your passion or follow the money when choosing a career?", category: "edge", expectedAgreement: "medium" },
  { id: 97, prompt: "Is it possible to have a healthy diet as a vegan?", category: "edge", expectedAgreement: "high" },
  { id: 98, prompt: "Does money buy happiness?", category: "edge", expectedAgreement: "medium" },
  { id: 99, prompt: "Is multitasking effective?", category: "edge", expectedAgreement: "high" },
  { id: 100, prompt: "Should you learn to code even if you are not a software developer?", category: "edge", expectedAgreement: "medium" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQuestion(question, index, total) {
  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: question.prompt }),
    });

    const data = await response.json();
    const durationMs = Date.now() - startTime;

    if (!data.ok) {
      console.log(`[${index}/${total}] FAILED — ${question.prompt.slice(0, 50)}... (${data.error})`);
      return {
        ...question,
        status: "error",
        error: data.error,
        durationMs,
        result: null,
      };
    }

    const result = {
      agreementLevel: data.comparison?.agreementLevel,
      disagreementType: data.decisionVerification?.disagreementType,
      trustScore: data.trustScore?.score,
      trustLabel: data.trustScore?.label,
      riskLevel: data.decisionVerification?.riskLevel,
      finalConclusionAligned: data.decisionVerification?.finalConclusionAligned,
      verdict: data.decisionVerification?.verdict,
      semanticJudgeModel: data.comparison?.semanticJudgeModel,
      selectedProviders: data.selectedProviders,
    };

    const agreementMatch = result.agreementLevel === question.expectedAgreement;
    const marker = agreementMatch ? "✓" : "~";

    console.log(
      `[${index}/${total}] ${marker} ${question.category.padEnd(12)} | ` +
      `expected: ${question.expectedAgreement.padEnd(6)} | ` +
      `got: ${(result.agreementLevel || "null").padEnd(6)} | ` +
      `trust: ${result.trustScore ?? "?"} | ` +
      `${(durationMs / 1000).toFixed(1)}s | ` +
      `${question.prompt.slice(0, 45)}...`
    );

    return {
      ...question,
      status: "ok",
      durationMs,
      result,
      agreementMatch,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.log(`[${index}/${total}] ERROR — ${question.prompt.slice(0, 50)}... (${err.message})`);
    return {
      ...question,
      status: "error",
      error: err.message,
      durationMs,
      result: null,
    };
  }
}

async function main() {
  console.log(`\nZorelan Benchmark Runner`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Questions: ${QUESTIONS.length}`);
  console.log(`Delay between calls: ${DELAY_MS}ms`);
  console.log(`Estimated time: ${Math.ceil((QUESTIONS.length * (DELAY_MS + 8000)) / 60000)} minutes\n`);
  console.log("Starting in 3 seconds — press Ctrl+C to cancel...\n");

  await sleep(3000);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < QUESTIONS.length; i++) {
    const question = QUESTIONS[i];
    const result = await runQuestion(question, i + 1, QUESTIONS.length);
    results.push(result);

    // Save after every 10 questions in case of interruption
    if ((i + 1) % 10 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
      console.log(`\n  [Saved ${i + 1} results to benchmark/results.json]\n`);
    }

    if (i < QUESTIONS.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

  // Summary
  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  const successful = results.filter((r) => r.status === "ok");
  const errors = results.filter((r) => r.status === "error");
  const agreementMatches = successful.filter((r) => r.agreementMatch);

  const byCategory = {};
  for (const r of successful) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, matched: 0, trustScores: [] };
    }
    byCategory[r.category].total++;
    if (r.agreementMatch) byCategory[r.category].matched++;
    if (r.result?.trustScore) byCategory[r.category].trustScores.push(r.result.trustScore);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`BENCHMARK COMPLETE`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total time: ${totalTime} minutes`);
  console.log(`Successful: ${successful.length}/${QUESTIONS.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`\nAgreement prediction accuracy: ${agreementMatches.length}/${successful.length} (${Math.round((agreementMatches.length / successful.length) * 100)}%)`);
  console.log(`\nBy category:`);

  for (const [category, stats] of Object.entries(byCategory)) {
    const avgTrust = stats.trustScores.length
      ? Math.round(stats.trustScores.reduce((a, b) => a + b, 0) / stats.trustScores.length)
      : "?";
    console.log(
      `  ${category.padEnd(14)} | agreement accuracy: ${stats.matched}/${stats.total} | avg trust: ${avgTrust}`
    );
  }

  console.log(`\nResults saved to: benchmark/results.json`);
  console.log(`\nNext step: open benchmark/review.html to label results`);
}

main().catch(console.error);