import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modelOpenness } from '../src/data/ocr-openness.ts';
import { criteria, overallChecks, score, scoreLabel, opennessAnchor } from '../src/lib/ocr-openness.ts';

const checks = status => Object.fromEntries(criteria.map(([key]) => [key, { status, note: 'Test evidence', sources: ['https://example.org/'] }]));
const profile = (base, post) => ({ base: { checks: base }, post: { checks: post } });

test('open post-training cannot compensate for unavailable upstream data or code', () => {
  const base = checks('yes'), post = checks('yes');
  base.data.status = 'no'; base.code.status = 'partial';
  const result = overallChecks(profile(base, post));
  assert.equal(scoreLabel(post), '6 of 6');
  assert.equal(scoreLabel(result), '4 of 6');
  assert.equal(result.data.status, 'no');
  assert.equal(result.code.status, 'partial');
  assert.equal(post.data.status, 'yes'); // Derived checks never mutate evidence.
});

test('unknown stays distinct from closed and partial, including an undisclosed base', () => {
  const base = checks('unknown'), post = checks('yes');
  assert.equal(scoreLabel(base), 'Unknown');
  assert.equal(scoreLabel(checks('no')), '0 of 6');
  assert.equal(scoreLabel(overallChecks(profile(base, post))), '4 of 6');
  assert.equal(score(overallChecks(profile(base, post))).unknown, 2);
  post.data.status = 'partial';
  assert.equal(scoreLabel(overallChecks(profile(base, post))), '4 of 6');
  assert.equal(score(overallChecks(profile(base, post))).unknown, 1);
  base.code.status = 'no';
  assert.equal(scoreLabel(overallChecks(profile(base, post))), '4 of 6');
  assert.equal(score(overallChecks(profile(base, post))).unknown, 0);
});

test('release artifacts and training lineage are assessed at their documented scopes', () => {
  const base = checks('yes'), post = checks('yes');
  base.paper.status = 'no';
  assert.equal(scoreLabel(overallChecks(profile(base, post))), '6 of 6');
  post.license.status = 'no';
  const combined = overallChecks(profile(base, post));
  assert.equal(combined.weights.status, 'yes');
  assert.equal(scoreLabel(combined), '5 of 6');
});

test('all published models have complete, sourced and dated evidence', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../public/ocr-eval/results.json', import.meta.url)));
  assert.deepEqual(Object.keys(modelOpenness).sort(), snapshot.models.map(m => m.id).sort());
  for (const [id, value] of Object.entries(modelOpenness)) {
    assert.match(value.reviewed, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(decodeURIComponent(opennessAnchor(id)), id);
    for (const stage of [value.base, value.post]) {
      assert.ok(stage.name && stage.description);
      assert.deepEqual(Object.keys(stage.checks).sort(), criteria.map(([key]) => key).sort());
      for (const item of Object.values(stage.checks)) {
        assert.ok(['yes', 'no', 'partial', 'unknown'].includes(item.status));
        assert.ok(item.note.length > 10 && item.sources.length > 0);
        item.sources.forEach(source => assert.equal(new URL(source).protocol, 'https:'));
      }
      const { confirmed, unknown } = score(stage.checks);
      assert.ok(confirmed >= 0 && unknown >= 0 && confirmed + unknown <= 6);
    }
  }
  assert.equal(modelOpenness['Sprakbanken/TrOCR-norhand-v3'].post.checks.data.status, 'yes');
  assert.equal(overallChecks(modelOpenness['Sprakbanken/TrOCR-norhand-v3']).data.status, 'partial');
  assert.equal(modelOpenness['Riksarkivet/trocr-base-handwritten-hist-swe-2'].post.checks.data.status, 'partial');
  assert.equal(modelOpenness['google/gemma-3-4b-it'].post.checks.license.status, 'no');
  assert.equal(modelOpenness['google/gemma-4-E2B-it'].post.checks.license.status, 'yes');
});
