import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rankModels } from '../src/lib/ocr-results.ts';

const task = 'line-recognition';
const samples = [{ id: 'small', selected_samples: 10 }, { id: 'large', selected_samples: 1000 }];
const model = id => ({ id, name: id, family: '', reference: '', supported_tasks: [task] });
const result = (model_id, sample_set_id, cer, wer = cer) => ({ model_id, sample_set_id, status: 'completed', corpus_metrics: { cer, wer } });

test('each dataset has equal weight regardless of its sample count', () => {
  const rows = rankModels({ models: [model('A')], results: [result('A', 'small', .02), result('A', 'large', .08)] }, samples, task, 'cer');
  assert.equal(rows[0].metrics.cer, .05);
});

test('incomplete, unsupported, nonfinite and duplicate results cannot receive ranks', () => {
  const data = { models: ['valid', 'partial', 'unsupported', 'nonfinite', 'duplicate'].map(model), results: [] };
  data.models[2].supported_tasks = [];
  for (const m of data.models) data.results.push(result(m.id, 'small', .1), result(m.id, 'large', .2));
  data.results.find(r => r.model_id === 'partial').status = 'pending';
  data.results.find(r => r.model_id === 'nonfinite').corpus_metrics.cer = NaN;
  data.results.push(result('duplicate', 'small', .1));
  assert.deepEqual(rankModels(data, samples, task, 'cer').map(r => r.model.id), ['valid']);
  assert.deepEqual(rankModels(data, [], task, 'cer'), []);
});

test('ties share rank, sorting uses full precision, and error rates above 100% are retained', () => {
  const data = { models: ['A', 'B', 'C', 'D'].map(model), results: [result('A', 'small', .010001, .5), result('B', 'small', .010001, .4), result('C', 'small', .010002, .3), result('D', 'small', 1.5, 2)] };
  const rows = rankModels(data, samples.slice(0, 1), task, 'cer');
  assert.deepEqual(rows.map(r => r.rank), [1, 1, 3, 4]);
  assert.equal(rows[3].metrics.cer, 1.5);
  assert.equal(rankModels(data, samples.slice(0, 1), task, 'wer')[0].model.id, 'C');
});

test('all published model/dataset scores survive the redesign without alteration', () => {
  const data = JSON.parse(readFileSync(new URL('../public/ocr-eval/results.json', import.meta.url)));
  let checked = 0;
  for (const sample of data.sample_sets) {
    for (const row of rankModels(data, [sample], sample.task, 'cer')) {
      const original = data.results.find(r => r.model_id === row.model.id && r.sample_set_id === sample.id);
      assert.deepEqual(row.metrics, original.corpus_metrics);
      checked++;
    }
  }
  assert.equal(checked, 200);
  assert.equal(rankModels(data, data.sample_sets.filter(s => s.task === task), task, 'cer').length, 20);
  assert.equal(rankModels(data, data.sample_sets.filter(s => s.task === 'page-transcription'), 'page-transcription', 'cer').length, 16);
});
