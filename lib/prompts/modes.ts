export type Mode = "execution" | "strategy" | "decision";

export const MODE_BLOCK: Record<Mode, string> = {
  execution: `
Mode: EXECUTION

Bias:
- Speed, practicality, implementation clarity
- High-ROI / high-leverage actions
- Measurable outputs
Avoid:
- Philosophy, long theory, generic motivational advice

In the Optimized Prompt, require:
- Ranked actions by impact
- Time-to-impact
- Resources required
- Risks/obstacles
- KPIs
- 30–90 day roadmap
`.trim(),

  strategy: `
Mode: STRATEGY

Bias:
- Positioning, trade-offs, second-order effects
- Opportunity cost, structural risks
- Long-term implications
Avoid:
- Step-by-step execution plans as the main output
- Forced binary yes/no conclusions

In the Optimized Prompt, require:
- Core strategic tension
- Explicit trade-offs
- Short vs long-term consequences
- Scenario modeling (best/worst/likely)
- Risks/blind spots
- Reasoned strategic direction
`.trim(),

  decision: `
Mode: DECISION

Bias:
- Comparative evaluation and a definitive choice
- Risk-weighted recommendation
- Reversibility and opportunity cost
Avoid:
- "It depends" conclusions

In the Optimized Prompt, require:
- Option definitions
- Pros/cons comparatively
- Risk profiles
- Reversibility analysis
- Best/worst/likely for each
- Opportunity cost
- A FINAL definitive recommendation statement
`.trim(),
};