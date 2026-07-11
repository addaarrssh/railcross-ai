# Review Package Manifest

## Primary review documents

- `PROJECT_TECHNICAL_REVIEW.md` — detailed explanation and validation assessment.
- `DATA_DICTIONARY.md` — every synthetic dataset field and whether it enters the model.
- `REVIEW_PROMPT.md` — ready-to-paste instructions for another chat.
- `report.html` — self-contained interactive technical report.
- `artifact.json` — canonical source used to generate `report.html`.

## Source code included

- map UI and styles;
- synthetic traffic simulator;
- classifier and regressor training pipeline;
- inference wrapper;
- prediction export pipeline;
- crossing-coordinate fetch script;
- Python dependency list and JavaScript project metadata.

## Evidence included

- synthetic model evaluation JSON;
- trained classifier and reopening regressor bundles;
- complete 29,900-row synthetic observation CSV;
- 528-crossing coordinate JSON and CSV;
- 528 map-ready synthetic prediction snapshots;
- public coordinate layer used by the map.

## Explicit exclusions

- `.env.local` and every API key;
- `.git`, build caches, `node_modules`, `.wrangler`, and local runtime state;
- browser history, credentials, and machine-specific configuration.

The package is intended for technical review, not deployment.

