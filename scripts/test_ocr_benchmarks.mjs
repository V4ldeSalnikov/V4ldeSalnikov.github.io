import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { benchmarks } from '../src/data/ocr-benchmarks.ts';
import { rankModels } from '../src/lib/ocr-results.ts';

const snapshot = JSON.parse(readFileSync(new URL('../public/ocr-eval/results.json', import.meta.url)));

test('v1 benchmarks define fixed, unique tasks and language subsets', () => {
  assert.deepEqual(benchmarks.map(benchmark => benchmark.sampleIds.length), [11, 6, 2, 3]);
  assert.deepEqual(new Set(benchmarks[0].sampleIds), new Set(snapshot.sample_sets.map(sample => sample.id)));
  assert.deepEqual(new Set(benchmarks.slice(1).flatMap(benchmark => benchmark.sampleIds)), new Set(benchmarks[0].sampleIds));
  for (const benchmark of benchmarks) {
    assert.equal(new Set(benchmark.sampleIds).size, benchmark.sampleIds.length);
    for (const id of benchmark.sampleIds) {
      const sample = snapshot.sample_sets.find(sample => sample.id === id);
      const dataset = snapshot.datasets.find(dataset => dataset.id === sample.dataset_id);
      assert.ok(dataset.language_codes.every(language => benchmark.languages.includes(language)));
    }
    assert.equal(rankModels(snapshot, snapshot.sample_sets.filter(sample => benchmark.sampleIds.includes(sample.id)), null, 'cer').length, 16);
  }
});

test('mixed-input benchmarks weight tasks equally and require every supported task', () => {
  const samples = [{ id: 'lines', task: 'line-recognition', selected_samples: 1000 }, { id: 'pages', task: 'page-transcription', selected_samples: 100 }];
  const models = ['complete', 'line-only', 'missing-page'].map(id => ({ id, name: id, supported_tasks: id === 'line-only' ? ['line-recognition'] : ['line-recognition', 'page-transcription'] }));
  const results = models.flatMap(model => samples.filter(sample => model.id !== 'missing-page' || sample.id === 'lines').map(sample => ({
    model_id: model.id, sample_set_id: sample.id, status: 'completed', corpus_metrics: { cer: sample.id === 'lines' ? .02 : .08, wer: sample.id === 'lines' ? .1 : .3 },
  })));
  const rows = rankModels({ models, results }, samples, null, 'cer');
  assert.deepEqual(rows.map(row => row.model.id), ['complete']);
  assert.equal(rows[0].metrics.cer, .05);
  assert.equal(rows[0].metrics.wer, .2);
  assert.equal(rankModels({ models, results }, samples.slice(0, 1), null, 'cer').length, 3);
});
