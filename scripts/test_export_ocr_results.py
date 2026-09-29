"""Check cohort merging, QA gating and the public-data boundary."""
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import export_ocr_results as exporter


class ExportTests(unittest.TestCase):
    def snapshot(self, model, run):
        return {
            'run': {'id': run, 'git_commit': run, 'seed': 7, 'targets': {'line-recognition': 10},
                    'warnings': [], 'counts': {}},
            'models': [{'id': model}], 'datasets': [{'id': 'example'}],
            'sample_sets': [{'id': 'line-recognition/example', 'manifest_sha256': 'same'}],
            'results': [{'model_id': model, 'sample_set_id': 'line-recognition/example',
                         'status': 'completed', 'completed_samples': 10,
                         'successful_samples': 8, 'failed_samples': 2}],
        }

    def merge(self, left, right):
        with patch.object(exporter, 'export', side_effect=deepcopy([left, right])), \
             patch.object(exporter, 'model_metadata', return_value={'one': {}, 'two': {}}):
            return exporter.export_runs([Path('/root/runs/old'), Path('/root/runs/new')])

    def test_merge_preserves_failures_and_completed_status(self):
        merged = self.merge(self.snapshot('one', 'old'), self.snapshot('two', 'new'))
        counts = merged['run']['counts']
        self.assertEqual((counts['models'], counts['jobs'], counts['completed']), (2, 2, 2))
        self.assertEqual((counts['recorded_samples'], counts['successful_samples'], counts['failed_samples']), (20, 16, 4))
        self.assertEqual(len(merged['sample_sets']), 1)
        self.assertEqual([run['id'] for run in merged['source_runs']], ['old', 'new'])

    def test_rejects_changed_frozen_samples(self):
        right = self.snapshot('two', 'new')
        right['sample_sets'][0]['manifest_sha256'] = 'different'
        with self.assertRaisesRegex(AssertionError, 'Incompatible sample_sets'):
            self.merge(self.snapshot('one', 'old'), right)

    def test_rejects_duplicate_model_results(self):
        with self.assertRaisesRegex(AssertionError, 'Overlapping'):
            self.merge(self.snapshot('one', 'old'), self.snapshot('one', 'new'))

    def test_rejects_mixed_sampling(self):
        right = self.snapshot('two', 'new')
        right['run']['seed'] = 8
        with self.assertRaisesRegex(AssertionError, 'sampling seed'):
            self.merge(self.snapshot('one', 'old'), right)

    def test_public_export_omits_case_content_and_requires_qa(self):
        with TemporaryDirectory() as temp:
            run = Path(temp) / 'runs' / 'example'
            job = {'model': 'model/one', 'task': 'line-recognition', 'dataset': 'norhand', 'batch_size': 1}
            manifest = {'task': job['task'], 'dataset_key': 'norhand', 'dataset_id': 'Teklia/NorHand-v2-line',
                        'sampling_method': 'fixture', 'cases': [
                            {'metadata': {'split': 'test', 'private_path': 'C:/Users/private/image.png'},
                             'reference': 'PRIVATE_REFERENCE'}]}
            def write(path, value):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value), encoding='utf-8')
            sample = run / 'samples/line-recognition/norhand/manifest.json'
            write(sample, manifest)
            digest = sha256(sample.read_bytes()).hexdigest()
            write(run / 'plan.json', {'jobs': [job], 'targets': {'line-recognition': 1}, 'seed': 7, 'git_commit': 'commit'})
            directory = run / 'results/model--one/line-recognition/norhand'
            write(directory / 'status.json', {'status': 'completed', 'completed_samples': 1, 'sample_manifest_sha256': digest})
            report = {'model': job['model'], 'task': job['task'], 'dataset': manifest['dataset_id'],
                      'corpus_metrics': {'cer': 1.0, 'wer': 1.0},
                      'benchmark': {'sample_manifest_sha256': digest},
                      'cases': [{'reference': 'PRIVATE_REFERENCE', 'prediction': '',
                                 'partial_prediction': 'PRIVATE_PARTIAL', 'inference_status': 'failed'}]}
            write(directory / 'report.json', report)
            checked = {**job, 'passed': True, 'case_count': 1, 'corpus_metrics': report['corpus_metrics']}
            write(run / 'report_qa.json', {'reports': [checked]})
            with patch.object(exporter, 'model_metadata', return_value={'model/one': {'name': 'model/one'}}):
                public = exporter.export(run)
                self.assertEqual(public['results'][0]['failed_samples'], 1)
                self.assertEqual(public['results'][0]['status'], 'completed')
                encoded = json.dumps(public)
                self.assertNotIn('PRIVATE_', encoded)
                self.assertNotIn('C:/Users', encoded)
                checked['passed'] = False
                write(run / 'report_qa.json', {'reports': [checked]})
                with self.assertRaises(KeyError):
                    exporter.export(run)


if __name__ == '__main__':
    unittest.main()
