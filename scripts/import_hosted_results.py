"""Add audited public hosted reports and their predictions to the existing website data."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    options = {'indent': 2} if path.name == 'index.json' else {'separators': (',', ':')}
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, **options) + '\n', encoding='utf-8')


def counts(results, models, datasets, samples):
    states = Counter(r['status'] for r in results)
    return {'models': models, 'datasets': datasets, 'sample_sets': samples, 'jobs': len(results),
            **{s: states[s] for s in ('completed', 'running', 'pending', 'failed', 'blocked')},
            **{key: sum(r[key] for r in results) for key in ('successful_samples', 'failed_samples')},
            'recorded_samples': sum(r['completed_samples'] for r in results)}


def import_runs(run_dirs, public):
    data = read(public / 'results.json')
    index = read(public / 'examples/index.json')
    samples = {s['id']: s for s in data['sample_sets']}
    examples = {x['id']: read(public / 'examples' / f"{x['id']}.json") for g in index['groups'] for x in g['examples']}
    sources = {r['id']: r for r in data.get('source_runs', [data['run']])}
    for run in run_dirs:
        published = read(run / 'index.json')
        assert published['status'] == 'completed' and published['validation']['passed']
        assert published['seed'] == data['run']['seed'] and published['targets'] == data['run']['targets']
        model = published['model']
        model_id = model['id']
        run_id = published['run_id']
        assert not any(r['model_id'] == model_id and r['run_id'] != run_id for r in data['results']), 'Conflicting model configuration'
        new_results, reports = [], {}
        for entry in published['tasks']:
            path = (run / entry['report']).resolve()
            assert path.is_relative_to(run.resolve()), 'Report path escapes published run'
            assert sha256(path.read_bytes()).hexdigest() == entry['sha256'], 'Public report changed'
            report = read(path)
            sample = samples[report['sample_set_id']]
            assert report['model_id'] == model_id and report['run_id'] == run_id
            assert report['manifest_sha256'] == sample['manifest_sha256']
            assert report['source_revision'] == sample['source_revision']
            assert len(report['cases']) == report['completed_samples'] == sample['selected_samples']
            assert report['corpus_metrics'] == entry['corpus_metrics']
            assert all(c['prediction'] == '' for c in report['cases'] if c['inference_status'] == 'failed')
            result = {k: report[k] for k in ('run_id', 'model_id', 'sample_set_id', 'status', 'completed_samples',
                      'successful_samples', 'failed_samples', 'selected_samples', 'corpus_metrics', 'batch_size',
                      'started_at', 'finished_at', 'code_revision', 'implementation_sha256', 'inference_settings', 'failure_policy')}
            result.update(target_samples=published['targets'][report['task']], model_revision=None,
                          warnings=['line-crop'] if sample['id'] == 'line-recognition/modern-danish' else [],
                          runtime_guards=report['runtime_settings'], gpu_memory=None,
                          estimated_cost_usd=report['estimated_cost_usd'], usage_info=report['usage_info'],
                          public_report_url=f"https://github.com/V4ldeSalnikov/OCR-eval/blob/main/results/{run_id}/{entry['report']}")
            new_results.append(result)
            reports[report['sample_set_id']] = report
        assert len(new_results) == len(published['tasks']) == 11
        assert sum(r['completed_samples'] for r in new_results) == published['samples'] == 6477
        for example in examples.values():
            report = reports.get(example['sample_set_id'])
            if report is None:
                continue
            matches = [c for c in report['cases'] if c['name'] == example['case_id']]
            assert len(matches) == 1, 'Example missing from report'
            case = matches[0]
            assert case['reference'] == example['reference'], 'Reference alignment changed'
            assert case['image_sha256'] == example['image_sha256'], 'Example image changed'
            example['predictions'][model_id] = {'text': case['prediction'], 'cer': case['cer'], 'wer': case['wer'],
                                               'inference_status': case['inference_status'], 'run_id': run_id}
        data['models'] = [m for m in data['models'] if m['id'] != model_id] + [model]
        data['results'] = [r for r in data['results'] if r['model_id'] != model_id] + new_results
        sources[run_id] = {'id': run_id, 'git_commit': published['code_revision'], 'seed': published['seed'],
                          'targets': published['targets'], 'metric_policy': data['run']['metric_policy'],
                          'warnings': [], 'counts': counts(new_results, 1, len({r['sample_set_id'].split('/')[1] for r in new_results}), 11),
                          'estimated_cost_usd': published['estimated_cost_usd']}
    assert len({(r['model_id'], r['sample_set_id']) for r in data['results']}) == len(data['results'])
    data['source_runs'] = list(sources.values())
    data['generated_at'] = datetime.now(timezone.utc).isoformat()
    data['run'].update(id=' + '.join(sources), git_commit=', '.join(dict.fromkeys(s['git_commit'] for s in sources.values())),
                       counts=counts(data['results'], len(data['models']), len(data['datasets']), len(samples)))
    data['run'].pop('excluded_model_count', None)  # A public bundle need not be in the local model registry.
    index['counts']['predictions'] = sum(len(e['predictions']) for e in examples.values())
    for identifier, example in examples.items():
        write(public / 'examples' / f'{identifier}.json', example)
    write(public / 'examples/index.json', index)
    write(public / 'results.json', data)
    return {'results': data['run']['counts'], 'examples': index['counts']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--published-run', required=True, action='append', type=Path)
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public/ocr-eval')
    args = parser.parse_args()
    print(json.dumps(import_runs([p.resolve() for p in args.published_run], args.public_dir.resolve())))
