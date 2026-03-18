type CalibrationTest =
  | { prompt: string; min: number }
  | { prompt: string; range: [number, number] };

const tests: CalibrationTest[] = [
  { prompt: "Is water made of hydrogen and oxygen?", min: 94 },
  { prompt: "Should I use HTTPS for my web application?", min: 90 },
  { prompt: "Should I use TypeScript or JavaScript for a new project?", range: [80, 90] },
  { prompt: "Should I raise venture capital or bootstrap my startup?", range: [80, 90] },
  { prompt: "Is cryptocurrency a good long-term investment?", range: [30, 70] },
];

async function run() {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error("Missing API_KEY environment variable.");
    process.exit(1);
  }

  let failed = false;

  for (const t of tests) {
    const res = await fetch("http://localhost:3000/api/decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: t.prompt,
        cache_bypass: true,
      }),
    });

    const data = await res.json();

    const score = data?.trust_score?.score;
    const taskType = data?.meta?.task_type;

    if (typeof score !== "number") {
      failed = true;
      console.error(`FAIL: ${t.prompt} -> no numeric score returned`);
      console.error("task_type:", taskType);
      console.error(data);
      continue;
    }

    if ("min" in t) {
      if (score < t.min) {
        failed = true;
        console.error(`FAIL: ${t.prompt} -> ${score} < ${t.min}`);
        console.error("task_type:", taskType);
        continue;
      }
    }

    if ("range" in t) {
      if (score < t.range[0] || score > t.range[1]) {
        failed = true;
        console.error(
          `FAIL: ${t.prompt} -> ${score} not in [${t.range[0]}, ${t.range[1]}]`
        );
        console.error("task_type:", taskType);
        continue;
      }
    }

    console.log(`PASS: ${t.prompt} -> ${score} (task_type: ${taskType})`);
  }

  if (failed) {
    process.exit(1);
  }

  console.log("All calibration tests passed.");
}

run().catch((err) => {
  console.error("Calibration test runner crashed.");
  console.error(err);
  process.exit(1);
});