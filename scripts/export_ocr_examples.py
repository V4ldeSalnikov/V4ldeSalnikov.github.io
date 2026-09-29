"""Publish a small, attributed sample of actual benchmark inputs and predictions."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import shutil

from export_ocr_results import read_bytes, read_json

SELECTION = "First three cases by SHA256('scandiocr-examples-v1:' + case name), independent of model scores."
CC_BY = "https://creativecommons.org/licenses/by/4.0/"
# Source cards checked before publication. Riksarkivet examples explicitly authorised by the user.
SOURCES = {
    "norhand": ("TEKLIA / Hugin-Munin project", "MIT", "https://opensource.org/license/mit"),
    "historical-danish": ("Aarhus City Archives and contributing archives", "CC BY 4.0", CC_BY),
    "modern-danish": ("Danish National Archives", "CC BY 4.0", CC_BY),
    "danish-typewritten": ("EHRI dataset contributors / Danish National Archives; line dataset by V4ldeLund", "CC BY 4.0", CC_BY),
    "swedish-fraktur": ("Språkbanken / Swedish National Archives", "Apache 2.0", "https://www.apache.org/licenses/LICENSE-2.0"),
    "riksarkivet-ood": ("Swedish National Archives", "License not stated by source", "https://huggingface.co/datasets/Riksarkivet/eval_htr_out_of_domain_lines"),
    "oj4ocrmt-danish": ("Paul McNamee et al. / JHU HLTCOE / European Union", "CC BY 4.0", CC_BY),
    "oj4ocrmt-swedish": ("Paul McNamee et al. / JHU HLTCOE / European Union", "CC BY 4.0", CC_BY),
    "nasjonalt-vitenarkiv": ("Original NVA publication authors; dataset by Danish Foundation Models", "CC0", "https://creativecommons.org/publicdomain/zero/1.0/"),
}


def select_cases(cases, count=3):
    return sorted(cases, key=lambda case: sha256(("scandiocr-examples-v1:" + case["name"]).encode()).digest())[:count]


def checked_image(folder, case):
    path = (folder / case["image"]).resolve()
    assert path.is_relative_to(folder.resolve()), "Image path escapes sample directory"
    assert path.suffix == ".png"
    assert sha256(read_bytes(path)).hexdigest() == case["image_sha256"], "Changed input image"
    return path


def export_examples(snapshot, ocr_root, output):
    datasets = {item["id"]: item for item in snapshot["datasets"]}
    examples, groups, qa_cache = {}, [], {}
    images = output / "images"
    images.mkdir(parents=True, exist_ok=True)
    for sample in snapshot["sample_sets"]:
        dataset = datasets[sample["dataset_id"]]
        if dataset["id"] not in SOURCES:
            continue
        results = [result for result in snapshot["results"] if result["sample_set_id"] == sample["id"]]
        run = ocr_root / "runs" / results[0]["run_id"]
        folder = run / "samples" / sample["task"] / dataset["id"]
        manifest_path = folder / "manifest.json"
        assert sha256(read_bytes(manifest_path)).hexdigest() == sample["manifest_sha256"]
        manifest = read_json(manifest_path)
        cases = select_cases(manifest["cases"])
        group = {"sample_set_id": sample["id"], "dataset_id": dataset["id"], "task": sample["task"], "examples": []}
        for case in cases:
            if dataset["id"] == "nasjonalt-vitenarkiv":
                assert case["metadata"].get("license") == "CC0", "NVA examples must have a per-document CC0 license"
            identifier = sha256((sample["id"] + ":" + case["name"]).encode()).hexdigest()[:20]
            source_image = checked_image(folder, case)
            shutil.copyfile(source_image, images / f"{identifier}.png")
            creator, license_name, license_url = SOURCES[dataset["id"]]
            example = {
                "id": identifier, "case_id": case["name"], "sample_set_id": sample["id"],
                "image_url": f"/ocr-eval/examples/images/{identifier}.png", "image_sha256": case["image_sha256"],
                "reference": case["reference"], "source_revision": sample["source_revision"],
                "attribution": {"creator": creator, "source_url": dataset["source_url"],
                                "license": license_name, "license_url": license_url,
                                "changes": "Benchmark input copied unchanged; line inputs may be crops made by the dataset adapter."},
                "predictions": {},
            }
            if case["metadata"].get("url"):
                example["attribution"]["document_url"] = case["metadata"]["url"]
            examples[(sample["id"], case["name"])] = example
            group["examples"].append({"id": identifier, "case_id": case["name"]})
        groups.append(group)
        for result in results:
            assert result["status"] == "completed"
            run = ocr_root / "runs" / result["run_id"]
            if run not in qa_cache:
                qa_cache[run] = {(row["model"], row["task"], row["dataset"]): row for row in read_json(run / "report_qa.json")["reports"] if row["passed"]}
            qa = qa_cache[run][(result["model_id"], sample["task"], dataset["id"])]
            report = read_json(run / "results" / result["model_id"].replace("/", "--") / sample["task"] / dataset["id"] / "report.json")
            assert report["model"] == result["model_id"] and report["task"] == sample["task"]
            assert report["benchmark"]["sample_manifest_sha256"] == sample["manifest_sha256"]
            assert qa["corpus_metrics"] == report["corpus_metrics"]
            assert qa["case_count"] == len(report["cases"]) == sample["selected_samples"]
            matched = 0
            for case in report["cases"]:
                example = examples.get((sample["id"], case["name"]))
                if example is None:
                    continue
                assert case["reference"] == example["reference"], "Image/reference/report alignment mismatch"
                assert result["model_id"] not in example["predictions"], "Duplicate case prediction"
                if case.get("inference_status") == "failed":
                    assert case["prediction"] == ""
                example["predictions"][result["model_id"]] = {
                    "text": case["prediction"], "cer": case["cer"], "wer": case["wer"],
                    "inference_status": case.get("inference_status", "success"), "run_id": result["run_id"],
                }
                matched += 1
            assert matched == len(cases), "Selected case missing from report"
    for example in examples.values():
        (output / f"{example['id']}.json").write_text(json.dumps(example, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n", encoding="utf-8")
    index = {"schema_version": 1, "selection": SELECTION, "groups": groups,
             "not_published": [{"dataset_id": item["id"], "reason": "The source release has no stated image redistribution license."}
                               for item in snapshot["datasets"] if item["id"] not in SOURCES],
             "counts": {"examples": len(examples), "predictions": sum(len(item["predictions"]) for item in examples.values()),
                        "datasets": len({group["dataset_id"] for group in groups})}}
    (output / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return index


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ocr-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "ocr-eval" / "examples")
    args = parser.parse_args()
    snapshot = read_json(Path(__file__).resolve().parents[1] / "public" / "ocr-eval" / "results.json")
    print(json.dumps(export_examples(snapshot, args.ocr_root.resolve(), args.output.resolve())["counts"]))
