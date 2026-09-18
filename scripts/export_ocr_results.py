"""Export public OCR scores, never case text, images, credentials, or local paths."""

import argparse
import ast
from collections import Counter
import ctypes
from ctypes import wintypes
from datetime import UTC, datetime
from hashlib import sha256
import json
import os
from pathlib import Path


DATASETS = {
    "norhand": ("NorHand handwriting", "no", "handwritten", "Teklia/NorHand-v2-line"),
    "historical-danish": ("Historical Danish handwriting", "da", "handwritten", "aarhus-city-archives/historical-danish-handwriting"),
    "modern-danish": ("Modern Danish handwriting", "da", "handwritten", "RA-Data-Science/modern-danish-handwriting"),
    "danish-typewritten": ("Danish diplomatic reports · typewritten", "da", "printed", "V4ldeLund/ehri-danish-typewritten-lines"),
    "riksarkivet-ood": ("Riksarkivet OOD handwriting", "sv", "handwritten", "Riksarkivet/eval_htr_out_of_domain_lines"),
    "swedish-fraktur": ("Swedish Fraktur print", "sv", "printed", "Riksarkivet/swedish_fraktur"),
    "oj4ocrmt-danish": ("EU Official Journal · Danish", "da", "printed", "hltcoe/OJ4OCRMT"),
    "oj4ocrmt-swedish": ("EU Official Journal · Swedish", "sv", "printed", "hltcoe/OJ4OCRMT"),
    "nasjonalt-vitenarkiv": ("Nasjonalt vitenarkiv · Norwegian documents", "no", "printed", "danish-foundation-models/nasjonalt-vitenarkiv"),
}
WARNINGS = {
    "mvp-incomplete": "This MVP run is incomplete. Compare completed results on the same frozen datasets, not averages over different completed subsets.",
    "repetition": "Repeated generated text was observed. Scores retain these errors; the cause is not yet established, so comparisons remain provisional.",
    "pdf-reference": "References were extracted from source PDFs, not independently transcribed by humans; extraction and reading-order errors can affect scores.",
    "source-train-split": "Samples come from the source dataset's train split; this is not an official held-out test split. This alone does not establish model training overlap.",
    "in-domain": "This model was fine-tuned on the NorHand dataset family. Interpret this pairing as in-domain, not an out-of-domain result.",
}


def read_bytes(path):
    # Allow active Windows workers to atomically replace files while we read.
    if os.name == "nt":
        import msvcrt

        create = ctypes.windll.kernel32.CreateFileW
        create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                           wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        create.restype = wintypes.HANDLE
        handle = create(str(path), 0x80000000, 7, None, 3, 128, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError()
        with os.fdopen(msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY), "rb") as source:
            return source.read()
    return path.read_bytes()


def read_json(path):
    return json.loads(read_bytes(path))


def model_metadata(ocr_root):
    metadata = {}
    fields = {"name", "family", "license", "reference", "supported_tasks", "notes"}
    for path in (ocr_root / "models" / "models_implementations").glob("*.py"):
        tree = ast.parse(read_bytes(path).decode("utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "ModelMeta":
                values = {item.arg: ast.literal_eval(item.value) for item in node.keywords if item.arg in fields}
                metadata[values["name"]] = values
    return metadata


def export(run_dir):
    plan = read_json(run_dir / "plan.json")
    metadata = model_metadata(run_dir.parents[1])
    model_names = list(dict.fromkeys(job["model"] for job in plan["jobs"]))
    models = [{"id": name, **metadata[name],
               "family": metadata[name].get("family") or name.split("/")[0],
               "warnings": ["repetition"] if name == "stepfun-ai/GOT-OCR-2.0-hf" else []}
              for name in model_names]
    sample_sets, manifests, hashes = [], {}, {}
    for task, dataset in dict.fromkeys((job["task"], job["dataset"]) for job in plan["jobs"]):
        sample_id = f"{task}/{dataset}"
        path = run_dir / "samples" / task / dataset / "manifest.json"
        data = read_bytes(path)
        manifest = json.loads(data)
        assert manifest["task"] == task and manifest["dataset_key"] == dataset
        manifests[sample_id], hashes[sample_id] = manifest, sha256(data).hexdigest()
        first = manifest["cases"][0]["metadata"] if manifest["cases"] else {}
        sample_sets.append({
            "id": sample_id, "dataset_id": dataset, "task": task,
            "selected_samples": len(manifest["cases"]), "target_samples": plan["targets"][task],
            "source_revision": manifest.get("source_revision"), "split": first.get("split"),
            "sampling_method": manifest["sampling_method"], "manifest_sha256": hashes[sample_id],
            "reference_type": first.get("reference_type", "annotated_text"),
        })
    datasets = []
    for dataset in dict.fromkeys(job["dataset"] for job in plan["jobs"]):
        label, language, document_type, source = DATASETS[dataset]
        views = [sample for sample in sample_sets if sample["dataset_id"] == dataset]
        warnings = ["source-train-split"] if any(view["split"] == "train" for view in views) else []
        if any(view["reference_type"] == "pdf_text" for view in views):
            warnings.append("pdf-reference")
        datasets.append({"id": dataset, "label": label, "language_codes": [language],
                         "document_type": document_type, "source_url": f"https://huggingface.co/datasets/{source}",
                         "tasks": [view["task"] for view in views], "warnings": warnings})
    results = []
    for job in plan["jobs"]:
        sample_id = f"{job['task']}/{job['dataset']}"
        manifest = manifests[sample_id]
        directory = run_dir / "results" / job["model"].replace("/", "--") / job["task"] / job["dataset"]
        state_path = directory / "status.json"
        state = read_json(state_path) if state_path.exists() else {"status": "pending", "completed_samples": 0}
        metrics = None
        if state["status"] == "completed":
            report = read_json(directory / "report.json")
            assert report["model"] == job["model"] and report["task"] == job["task"]
            assert report["dataset"] == manifest["dataset_id"]
            assert len(report["cases"]) == state["completed_samples"] == len(manifest["cases"])
            assert report["benchmark"]["sample_manifest_sha256"] == state["sample_manifest_sha256"] == hashes[sample_id]
            metrics = {name: report["corpus_metrics"][name] for name in ("cer", "wer")}
        warnings = []
        if job["model"] == "stepfun-ai/GOT-OCR-2.0-hf" or (job["model"] == "Qwen/Qwen2-VL-2B-Instruct" and sample_id == "page-transcription/historical-danish"):
            warnings.append("repetition")
        if job["model"] == "Sprakbanken/TrOCR-norhand-v3" and job["dataset"] == "norhand":
            warnings.append("in-domain")
        results.append({
            "model_id": job["model"], "sample_set_id": sample_id, "status": state["status"],
            "completed_samples": state.get("completed_samples", 0),
            "selected_samples": len(manifest["cases"]), "target_samples": plan["targets"][job["task"]],
            "corpus_metrics": metrics, "batch_size": job["batch_size"],
            "model_revision": state.get("model_revision"), "started_at": state.get("started_at"),
            "finished_at": state.get("finished_at"), "warnings": warnings,
        })
    states = Counter(result["status"] for result in results)
    return {
        "schema_version": 1, "generated_at": datetime.now(UTC).isoformat(),
        "run": {
            "id": run_dir.name, "git_commit": plan["git_commit"], "seed": plan["seed"],
            "targets": plan["targets"], "excluded_model_count": len(metadata) - len(models),
            "metric_policy": "Corpus CER/WER fractions; lower is better and values may exceed 1. Text is NFC-normalized and whitespace-collapsed; case and punctuation are preserved. Page metrics do not score layout structure.",
            "counts": {"models": len(models), "datasets": len(datasets), "sample_sets": len(sample_sets),
                       "jobs": len(results), **{name: states[name] for name in ("completed", "running", "pending", "failed", "blocked")},
                       "recorded_samples": sum(result["completed_samples"] for result in results)},
            "warnings": ["mvp-incomplete"] if states["completed"] != len(results) else [],
        },
        "tasks": [{"id": "line-recognition", "label": "Line recognition"},
                  {"id": "page-transcription", "label": "Page transcription"}],
        "models": models, "datasets": datasets, "sample_sets": sample_sets, "results": results,
        "warnings": [{"id": name, "message": message} for name, message in WARNINGS.items()],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "ocr-eval" / "results.json")
    args = parser.parse_args()
    data = export(args.run_dir.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(json.dumps(data["run"]["counts"]))
    print(f"Wrote {args.output.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
