import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modelOpenness } from '../src/data/ocr-openness.ts';
import { criteria, score, scoreLabel, opennessAnchor } from '../src/lib/ocr-openness.ts';

const checks = status => Object.fromEntries(criteria.map(([key]) => [key, { status, note: 'Test evidence', sources: ['https://example.org/'] }]));

test('one score counts the six available items without ranges or fractional points', () => {
  const items = checks('yes');
  assert.equal(scoreLabel(items), '6/6');
  items.data.status = 'unknown';
  items.code.status = 'partial';
  items.license.status = 'no';
  assert.equal(score(items), 3);
  assert.equal(scoreLabel(items), '3/6');
  assert.equal(items.data.status, 'unknown');
  assert.equal(items.weights.status, 'yes');
  assert.equal(scoreLabel(checks('unknown')), '0/6');
  assert.equal(scoreLabel(checks('no')), '0/6');
});

test('model releases are scored directly from their own evidence', () => {
  const norhand = modelOpenness['Sprakbanken/TrOCR-norhand-v3'];
  assert.equal(norhand.checks.data.status, 'yes');
  assert.equal(scoreLabel(norhand.checks), '4/6');
  assert.equal(modelOpenness['Riksarkivet/trocr-base-handwritten-hist-swe-2'].checks.data.status, 'partial');
  assert.equal(modelOpenness['google/gemma-3-4b-it'].checks.license.status, 'no');
  assert.equal(modelOpenness['google/gemma-4-E2B-it'].checks.license.status, 'yes');
  assert.equal(scoreLabel(modelOpenness['OpenAI/gpt-6.1-sol'].checks), '1/6');
});

test('all published models have one complete, sourced and dated evidence record', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../public/ocr-eval/results.json', import.meta.url)));
  assert.deepEqual(Object.keys(modelOpenness).sort(), snapshot.models.map(m => m.id).sort());
  for (const [id, value] of Object.entries(modelOpenness)) {
    assert.deepEqual(Object.keys(value).sort(), ['checks', 'reviewed']);
    assert.match(value.reviewed, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(decodeURIComponent(opennessAnchor(id)), id);
    assert.deepEqual(Object.keys(value.checks).sort(), criteria.map(([key]) => key).sort());
    for (const item of Object.values(value.checks)) {
      assert.ok(['yes', 'no', 'partial', 'unknown'].includes(item.status));
      assert.ok(item.note.length > 10 && item.sources.length > 0);
      item.sources.forEach(source => assert.equal(new URL(source).protocol, 'https:'));
    }
    assert.ok(score(value.checks) >= 0 && score(value.checks) <= 6);
  }
});
