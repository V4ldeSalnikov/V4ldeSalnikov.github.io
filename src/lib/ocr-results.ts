export type Metric = 'cer' | 'wer';
export type Dataset = { id: string; label: string; language_codes: string[]; document_type: string; tasks: string[] };
export type Model = { id: string; name: string; family: string; reference: string; supported_tasks: string[] };
export type SampleSet = { id: string; dataset_id: string; task: string; selected_samples: number };
export type Result = { model_id: string; sample_set_id: string; status: string; corpus_metrics: Record<Metric, number> | null };
export type Snapshot = { models: Model[]; datasets: Dataset[]; sample_sets: SampleSet[]; results: Result[] };
export type Row = { model: Model; metrics: Record<Metric, number>; rank: number };

export function rankModels(data: Snapshot, samples: SampleSet[], task: string | null, metric: Metric): Row[] {
  if (!samples.length) return [];
  const selected = new Set(samples.map(sample => sample.id));
  const tasks = task === null ? [...new Set(samples.map(sample => sample.task))] : [task];
  const rows = data.models.filter(model => tasks.every(task => model.supported_tasks.includes(task))).flatMap(model => {
    const results = data.results.filter(result => result.model_id === model.id && selected.has(result.sample_set_id));
    // Never rank a model on a smaller subset, or silently average duplicate reports.
    if (results.length !== samples.length || new Set(results.map(result => result.sample_set_id)).size !== samples.length
      || results.some(result => result.status !== 'completed' || !result.corpus_metrics
        || !Number.isFinite(result.corpus_metrics.cer) || !Number.isFinite(result.corpus_metrics.wer))) return [];
    return [{ model, rank: 0, metrics: {
      cer: results.reduce((sum, result) => sum + result.corpus_metrics!.cer, 0) / samples.length,
      wer: results.reduce((sum, result) => sum + result.corpus_metrics!.wer, 0) / samples.length,
    } }];
  }).sort((a, b) => a.metrics[metric] - b.metrics[metric] || a.model.name.localeCompare(b.model.name));
  rows.forEach((row, index) => {
    row.rank = index > 0 && row.metrics[metric] === rows[index - 1].metrics[metric] ? rows[index - 1].rank : index + 1;
  });
  return rows;
}
