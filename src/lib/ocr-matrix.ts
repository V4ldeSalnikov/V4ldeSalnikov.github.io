import { rankModels, type Metric, type Model, type SampleSet, type Snapshot } from './ocr-results.ts';

export type Aggregation = 'mean' | 'borda' | 'win-rate';
export type MatrixRow = { model: Model; scores: Record<string, number | null>; aggregate: number | null; rank: number | null };

// Each row contains the same tasks. Lower task error rates are better.
export function aggregateScores(values: number[][], method: Aggregation): (number | null)[] {
  const n = values.length, tasks = values[0]?.length ?? 0;
  if (!tasks) return values.map(() => null);
  if (values.some(row => row.length !== tasks || row.some(value => !Number.isFinite(value) || value < 0))) {
    throw new Error('Aggregation requires finite, non-negative scores on the same tasks.');
  }
  if (method === 'mean') return values.map(row => row.reduce((sum, value) => sum + value, 0) / tasks);
  if (method === 'borda') return values.map(row => row.reduce((sum, value, task) => {
    const better = values.filter(other => other[task] < value).length;
    const tied = values.filter(other => other[task] === value).length;
    return sum + better + (tied + 1) / 2;
  }, 0) / tasks);
  if (n < 2) return values.map(() => null);

  // Bradley–Terry MM fit, as in the Danish ASR leaderboard. Ties count as half a win.
  const wins = values.map(() => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    for (let task = 0; task < tasks; task++) {
      const credit = values[a][task] < values[b][task] ? 1 : values[a][task] === values[b][task] ? .5 : 0;
      wins[a][b] += credit; wins[b][a] += 1 - credit;
    }
  }
  const totals = wins.map(row => row.reduce((sum, value) => sum + value, 0));
  let strengths = values.map(() => 1);
  for (let iteration = 0; iteration < 200; iteration++) {
    const next = strengths.map((strength, a) => {
      const denominator = strengths.reduce((sum, opponent, b) => a === b ? sum : sum + tasks / (strength + opponent), 0);
      return Math.max(1e-12, totals[a] / denominator);
    });
    const scale = next.reduce((sum, value) => sum + value, 0) / n;
    strengths = next.map(value => value / scale);
  }
  return strengths.map((strength, a) => strengths.reduce((sum, opponent, b) =>
    a === b ? sum : sum + strength / (strength + opponent), 0) / (n - 1));
}

export function matrixRows(data: Snapshot, samples: SampleSet[], metric: Metric, method: Aggregation): MatrixRow[] {
  if (!samples.length) return [];
  const complete = new Set(rankModels(data, samples, null, metric).map(row => row.model.id));
  const rows: MatrixRow[] = data.models.map(model => ({ model, aggregate: null, rank: null,
    scores: Object.fromEntries(samples.map(sample => {
      const results = data.results.filter(result => result.model_id === model.id && result.sample_set_id === sample.id);
      const result = results.length === 1 ? results[0] : undefined;
      const value = result?.corpus_metrics?.[metric];
      const valid = model.supported_tasks.includes(sample.task) && result?.status === 'completed'
        && typeof value === 'number' && Number.isFinite(value) && value >= 0;
      return [sample.id, valid ? value : null];
    })),
  })).filter(row => Object.values(row.scores).some(value => value !== null));
  const eligible = rows.filter(row => complete.has(row.model.id) && samples.every(sample => row.scores[sample.id] !== null));
  const scores = aggregateScores(eligible.map(row => samples.map(sample => row.scores[sample.id]!)), method);
  eligible.forEach((row, i) => { row.aggregate = scores[i]; });
  rows.sort((a, b) => {
    if (a.aggregate === null || b.aggregate === null) return a.aggregate === b.aggregate
      ? a.model.name.localeCompare(b.model.name) : a.aggregate === null ? 1 : -1;
    return (method === 'win-rate' ? b.aggregate - a.aggregate : a.aggregate - b.aggregate) || a.model.name.localeCompare(b.model.name);
  });
  rows.forEach((row, i) => {
    if (row.aggregate !== null) row.rank = i > 0 && row.aggregate === rows[i - 1].aggregate ? rows[i - 1].rank : i + 1;
  });
  return rows;
}
