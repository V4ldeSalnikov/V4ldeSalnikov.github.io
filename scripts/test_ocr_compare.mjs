import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize, validModels, wordDiff } from '../src/lib/ocr-compare.ts';

test('comparison selection removes unknown/duplicate models and caps at three', () => {
  assert.deepEqual(validModels(['a', 'bogus', 'a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), ['a', 'b', 'c']);
});
test('word alignment preserves both sides, including accents, empty outputs and literal HTML', () => {
  for (const [reference, prediction] of [
    ['Føroyar og Ísland', 'Føroyar samt Island'], ['one missing word', 'one word'],
    ['', 'added'], ['missing', ''], ['', ''], [' A\n B ', 'A B'], ['a\u030a er her', 'å er her'],
    ['<script>alert(1)</script>', '<b>literal</b>'], ['same same same', 'same more same'],
  ]) {
    const diff = wordDiff(reference, prediction);
    assert.equal(diff.filter(p => p.kind !== 'insert').map(p => p.text).join(' '), normalize(reference));
    assert.equal(diff.filter(p => p.kind !== 'delete').map(p => p.text).join(' '), normalize(prediction));
  }
  assert.deepEqual(wordDiff('a wrong word', 'a right word').map(p => p.kind), ['equal', 'delete', 'insert', 'equal']);
});
test('very long repeated outputs use bounded alignment without dropping words', () => {
  const reference = 'start ' + 'original '.repeat(1100) + 'end';
  const prediction = 'start ' + 'repeated '.repeat(2500) + 'end';
  const diff = wordDiff(reference, prediction);
  assert.equal(diff.filter(p => p.kind !== 'insert').map(p => p.text).join(' '), normalize(reference));
  assert.equal(diff.filter(p => p.kind !== 'delete').map(p => p.text).join(' '), normalize(prediction));
  assert.ok(diff.length <= 4);
});
