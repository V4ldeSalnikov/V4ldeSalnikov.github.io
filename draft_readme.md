# ScandiOCR results website

The leaderboard is at `https://v4ldesalnikov.github.io/ocr-eval/`. It uses the existing Astro build and GitHub Pages workflow. No backend or API keys are needed for this first version.

## Refresh the results

Run the exporter with Python 3.12 from this repository:

```powershell
python scripts/export_ocr_results.py --run-dir D:/ScandiOCREval/OCR-eval/runs/mvp_20260917 --run-dir D:/ScandiOCREval/OCR-eval/runs/new_models_20260919
python -m unittest discover -s scripts -p "test_*.py" -v
node --test scripts/test_ocr_ranking.mjs
npm ci
npm run build
```

Review and commit `public/ocr-eval/results.json`, then push to `main` to publish through the existing Pages workflow. The website displays an exported snapshot, not a live connection to the evaluation machine.

The main results snapshot publishes aggregate scores and benchmark metadata. A separate, explicitly selected example gallery republishes 33 benchmark images, reference transcriptions and 600 saved model predictions with attribution. Other case data, local paths and credentials remain private.

The combined snapshot contains 20 model configurations and 200 completed evaluations (127,540 sample attempts). The exporter requires passed report QA for completed results and identical manifests for shared sample sets. It rejects duplicate model/sample-set results instead of silently choosing one. Each result keeps its source run, recorded code/model revisions, inference settings, runtime limits and failure count; schema version 2 also includes per-run provenance in `source_runs`.

## Reading the scores

CER and WER are error percentages: lower is better, and insertions can make them exceed 100%. A multi-dataset score is an unweighted mean of dataset corpus scores, available only after every selected dataset is completed. Incomplete evaluations are not ranked.

Complete means every selected sample was attempted. Failed attempts remain empty predictions in corpus CER/WER and are never silently skipped. The leaderboard shows rank, model, CER and WER; operational details remain in the results download.

The white-and-red OCR pages use a separate layout from the personal website. `/ocr-eval/datasets/` describes each collection, reference text and selected sample count. `/ocr-eval/methodology/` documents sampling, normalization, corpus metrics, equal-weight aggregation and inference settings. Dataset source descriptions live in `src/data/ocr-datasets.ts`; sample sizes and split names come from the published snapshot.

Filters and metric selection are reflected in the URL. Dataset sample links open the corresponding leaderboard selection. Models without a scored result for every selected dataset are omitted; search preserves the ranks of the full selection. The ranking tests verify that all 200 published model/dataset scores remain unchanged.

## Existing dependency maintenance

The existing website lockfile has 14 npm audit findings (1 critical, 9 high, 2 moderate, 2 low). This change does not upgrade the site stack. GitHub Pages serves static files, but build-tool vulnerabilities still need a separate maintenance pass. Keep development servers on loopback and do not add untrusted image optimization or raw HTML from result data.

## Model comparison and example gallery

Select up to three models with the leaderboard checkboxes, or open `/ocr-eval/compare/`.
The comparison table uses the same corpus metrics and equal-weight means as the leaderboard.
The example tab loads one example at a time and shows the original benchmark image, reference,
and saved prediction for each selected model. It supports zoom, word differences, original text,
copying, synchronized scrolling, and URLs that retain models and example selection.
All datasets are shown directly in comparison; line and page results keep separate means.
Long outputs initially show 12,000 characters with an explicit expansion control; copying always
copies the full saved text. Word alignment has a fixed work limit so repetition cannot freeze the page.

To rebuild the example gallery from the existing validated reports:

```powershell
python scripts/export_ocr_examples.py --ocr-root D:/ScandiOCREval/OCR-eval
python -m unittest discover -s scripts -p "test_*.py" -v
node --test scripts/test_ocr_ranking.mjs scripts/test_ocr_compare.mjs
npm run build
```

The exporter verifies report QA, sample manifests, image hashes and case/reference alignment.
Selection is model-independent and reproducible. Dataset terms and credit are recorded in
`public/ocr-eval/examples/ATTRIBUTION.md`; the Riksarkivet release's unstated license is recorded
as such, with its examples explicitly authorized for republication by the site owner.
NVA examples must have per-document CC0 metadata. The exporter copies original PNGs without
resizing and allowlists the exported fields; it does not copy arbitrary report metadata.
