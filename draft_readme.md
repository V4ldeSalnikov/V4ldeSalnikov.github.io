# ScandiOCR results website

The leaderboard is at `https://v4ldesalnikov.github.io/ocr-eval/`. It uses the existing Astro build and GitHub Pages workflow. No backend or API keys are needed for this first version.

## Refresh the results

Run the exporter with Python 3.12 from this repository:

```powershell
python scripts/export_ocr_results.py --run-dir D:/ScandiOCREval/OCR-eval/runs/mvp_20260917
npm ci
npm run build
```

Review and commit `public/ocr-eval/results.json`, then push to `main` to publish through the existing Pages workflow. The website displays an exported snapshot, not a live connection to the evaluation machine.

Only aggregate scores and benchmark metadata are published. Document images, references, predictions, local paths, and credentials remain private to the local run directory.

## Reading the scores

CER and WER are error percentages: lower is better, and insertions can make them exceed 100%. A multi-dataset score is an unweighted mean of dataset corpus scores, available only after every selected dataset is completed. Incomplete evaluations are not ranked.

This MVP uses frozen samples. Dataset provenance and warnings identify PDF-derived references, source training splits, in-domain models, and observed repeated generation. Results are preliminary, not publication-ready model rankings.

## Existing dependency maintenance

The existing website lockfile has 14 npm audit findings (1 critical, 9 high, 2 moderate, 2 low). This change does not upgrade the site stack. GitHub Pages serves static files, but build-tool vulnerabilities still need a separate maintenance pass. Keep development servers on loopback and do not add untrusted image optimization or raw HTML from result data.
