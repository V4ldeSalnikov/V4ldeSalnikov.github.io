import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { aggregateScores, matrixRows } from '../src/lib/ocr-matrix.ts';
import { rankModels } from '../src/lib/ocr-results.ts';
import { benchmarks } from '../src/data/ocr-benchmarks.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const samples = ['one', 'two'].map(id => ({id, dataset_id:id, task:'line-recognition', selected_samples:10}));
const model = id => ({id,name:id,family:'',reference:'',supported_tasks:['line-recognition']});
const result = (id, sample, score) => ({model_id:id,sample_set_id:sample,status:'completed',corpus_metrics:{cer:score,wer:score}});
const snapshot = JSON.parse(readFileSync(new URL('../public/ocr-eval/results.json', import.meta.url)));

test('mean preserves error magnitudes while Borda uses task positions and average ties', () => {
  const values = [[.01,.9],[.1,.1],[.2,.05]];
  assert.deepEqual(aggregateScores(values,'mean'),[.455,.1,.125]);
  assert.deepEqual(aggregateScores(values,'borda'),[2,2,2]);
  assert.deepEqual(aggregateScores([[1,1],[1,2],[3,1]],'borda'),[1.5,2.25,2.25]);
  assert.deepEqual(aggregateScores([[0,8.79]],'mean'),[4.395]);
});

test('Bradley–Terry handles ties, symmetric cycles, unanimous wins and known probabilities', () => {
  aggregateScores([[1,1],[1,1],[1,1]],'win-rate').forEach(value=>close(value,.5));
  aggregateScores([[1,3,2],[2,1,3],[3,2,1]],'win-rate').forEach(value=>close(value,.5));
  const pair=aggregateScores([[0,0,1,1],[1,1,0,1]],'win-rate');
  close(pair[0],.625); close(pair[1],.375);
  const unanimous=aggregateScores([[1,1],[2,2],[3,3]],'win-rate');
  assert.ok(unanimous[0]>.99 && unanimous[2]<.01);
  unanimous.forEach(value=>assert.ok(Number.isFinite(value)&&value>=0&&value<=1));
  close(unanimous.reduce((a,b)=>a+b,0)/3,.5);
  assert.deepEqual(aggregateScores([[1]],'win-rate'),[null]);
  assert.deepEqual(aggregateScores([],'mean'),[]);
  assert.throws(()=>aggregateScores([[1],[2,3]],'borda'));
  assert.throws(()=>aggregateScores([[NaN]],'mean'));
});

test('partial models remain visible without an overall score or changing the ranking pool', () => {
  const data={models:['A','B','partial','duplicate','empty'].map(model),results:[
    result('A','one',.1),result('A','two',.2),result('B','one',.2),result('B','two',.1),
    result('partial','one',.001),result('duplicate','one',.01),result('duplicate','one',.02),result('duplicate','two',.03)]};
  for(const method of ['mean','borda','win-rate']) {
    const rows=matrixRows(data,samples,'cer',method);
    assert.equal(rows.length,4);
    const partial=rows.find(row=>row.model.id==='partial');
    assert.equal(partial.aggregate,null); assert.equal(partial.scores.two,null); assert.equal(partial.scores.one,.001);
    const duplicate=rows.find(row=>row.model.id==='duplicate');
    assert.equal(duplicate.aggregate,null); assert.equal(duplicate.scores.one,null);
    const expected=aggregateScores([[.1,.2],[.2,.1]],method);
    close(rows.find(row=>row.model.id==='A').aggregate,expected[0]);
    close(rows.find(row=>row.model.id==='B').aggregate,expected[1]);
  }
});

test('Borda and win rate are invariant to input order and task error scale', () => {
  const values=[[.1,.4,.8],[.4,.2,.5],[.3,.1,.9]];
  for(const method of ['borda','win-rate']) {
    const original=aggregateScores(values,method);
    const reversed=aggregateScores([...values].reverse(),method).reverse();
    const scaled=aggregateScores(values.map(row=>row.map((v,i)=>v*(i+1)*100)),method);
    original.forEach((v,i)=>{close(v,reversed[i]);close(v,scaled[i]);});
  }
});

test('matrix retains all 222 published task scores and all four benchmark means', () => {
  for(const metric of ['cer','wer']) {
    const rows=matrixRows(snapshot,snapshot.sample_sets,metric,'mean');
    assert.equal(rows.length,22);
    assert.equal(rows.filter(row=>row.aggregate!==null).length,18);
    let checked=0;
    for(const row of rows) for(const [sample,value] of Object.entries(row.scores)) {
      if(value===null) continue;
      assert.equal(value,snapshot.results.find(r=>r.model_id===row.model.id&&r.sample_set_id===sample).corpus_metrics[metric]);
      checked++;
    }
    assert.equal(checked,222);
    for(const benchmark of benchmarks) {
      const tasks=snapshot.sample_sets.filter(sample=>benchmark.sampleIds.includes(sample.id));
      const matrix=matrixRows(snapshot,tasks,metric,'mean');
      for(const original of rankModels(snapshot,tasks,null,metric)) close(matrix.find(row=>row.model.id===original.model.id).aggregate,original.metrics[metric]);
      for(const method of ['borda','win-rate']) {
        const ranked=matrixRows(snapshot,tasks,metric,method).filter(row=>row.aggregate!==null);
        assert.equal(ranked.length,18);
        for(const row of ranked) assert.ok(Number.isFinite(row.aggregate));
      }
    }
  }
});
