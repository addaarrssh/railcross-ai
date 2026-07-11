# Prompt to paste into another chat

Please perform a rigorous technical review of the attached **RailCross review package**.

RailCross is a railway-crossing gate-status prediction prototype. It uses an official Google Maps base map, OpenStreetMap crossing coordinates, and a synthetic traffic simulator. The main classifier predicts OPEN/CLOSED from aggregate traffic speeds, stopped-vehicle ratios, bilateral queues, queue growth, delay, and congestion duration. It does not currently use live Google traffic or verified real-world gate labels.

Start with `PROJECT_TECHNICAL_REVIEW.md`, then inspect the actual source code and evidence files. Do not accept the report’s claims without checking them.

Please review:

1. Whether the simulator creates target leakage or unrealistically easy separation.
2. Whether ordinary congestion is a strong enough negative-control scenario.
3. Whether the 70/15/15 chronological event split is appropriate.
4. Whether threshold selection, class weighting, and row-level metrics are valid.
5. Whether event-level detection metrics are implemented correctly.
6. Whether the reopening-time regression formulation is appropriate.
7. Whether the map prediction export is honest and technically correct.
8. Which claims are safe for a resume and which would be misleading.
9. The smallest credible real-world data collection and validation plan.
10. Code bugs, reproducibility issues, security risks, and UI/model mismatches.

Return your review in this structure:

- Overall verdict: strong prototype / promising but needs revision / fundamentally flawed
- What is implemented correctly
- High-severity issues
- Medium-severity issues
- Low-severity improvements
- Model and data leakage audit
- Metric recomputation or discrepancies
- Real-world validation plan
- Resume-safe project description and bullet points
- Prioritized next five engineering tasks

Treat every performance metric as synthetic unless the package contains independent real-world evidence.

