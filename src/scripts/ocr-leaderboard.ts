type Metric = 'cer' | 'wer';
type Dataset = { id: string; label: string; language_codes: string[]; document_type: string; source_url: string; tasks: string[]; warnings: string[] };
type Model = { id: string; name: string; family: string; license: string; reference: string; supported_tasks: string[]; notes: string; warnings: string[] };
type SampleSet = { id: string; dataset_id: string; task: string; selected_samples: number; target_samples: number; source_revision: string | null; split: string | null; sampling_method: string; manifest_sha256: string; reference_type: string };
type Result = { model_id: string; sample_set_id: string; status: string; completed_samples: number; failed_samples: number; selected_samples: number; corpus_metrics: Record<Metric, number> | null; warnings: string[] };
type Snapshot = { generated_at: string; run: { id: string; git_commit: string; seed: number; metric_policy: string; excluded_model_count: number; warnings: string[]; counts: { models: number; datasets: number; jobs: number; completed: number; running: number; pending: number; failed: number; blocked: number; recorded_samples: number; failed_samples: number } }; tasks: { id: string; label: string }[]; models: Model[]; datasets: Dataset[]; sample_sets: SampleSet[]; results: Result[]; warnings: { id: string; message: string }[] };
type Row = { model: Model; results: Result[]; metrics: Record<Metric, number> | null; coverage: number; status: string; rank: number | null };

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const language = element<HTMLSelectElement>('language');
const documentType = element<HTMLSelectElement>('document-type');
const dataset = element<HTMLSelectElement>('dataset');
const search = element<HTMLInputElement>('model-search');
const metric = element<HTMLSelectElement>('metric');
const body = element<HTMLTableSectionElement>('results-body');
const taskButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-task]')];
let task = 'line-recognition';
let data: Snapshot;
const numbers = new Intl.NumberFormat('en-GB');
const percent = (value: number) => `${(value * 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const text = (id: string, value: string) => { element(id).textContent = value; };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') {
  const result = document.createElement(tag);
  result.textContent = value;
  result.className = className;
  return result;
}

function warningMessages(ids: string[]) {
  return [...new Set(ids)].map((id) => data.warnings.find((warning) => warning.id === id)!.message);
}

function matchingDatasets() {
  return data.datasets.filter((item) => item.tasks.includes(task)
    && (language.value === 'all' || item.language_codes.includes(language.value))
    && (documentType.value === 'all' || item.document_type === documentType.value));
}

function updateDatasetOptions() {
  const previous = dataset.value;
  dataset.replaceChildren(new Option('All matching datasets', 'all'));
  for (const item of matchingDatasets()) dataset.add(new Option(item.label, item.id));
  dataset.value = [...dataset.options].some((option) => option.value === previous) ? previous : 'all';
}

function modelRow(model: Model, samples: SampleSet[]): Row {
  const results = samples.flatMap((sample) => data.results.filter((result) => result.model_id === model.id && result.sample_set_id === sample.id));
  const completed = results.filter((result) => result.status === 'completed' && result.corpus_metrics !== null
    && Number.isFinite(result.corpus_metrics.cer) && Number.isFinite(result.corpus_metrics.wer));
  const eligible = samples.length > 0 && completed.length === samples.length;
  const metrics = eligible ? {
    cer: completed.reduce((sum, result) => sum + result.corpus_metrics!.cer, 0) / samples.length,
    wer: completed.reduce((sum, result) => sum + result.corpus_metrics!.wer, 0) / samples.length,
  } : null;
  const status = !model.supported_tasks.includes(task) ? 'not-supported'
    : eligible ? 'completed'
    : ['running', 'failed', 'blocked'].find((state) => results.some((result) => result.status === state)) ?? 'pending';
  return { model, results, metrics, coverage: completed.length, status, rank: null };
}

function renderRow(row: Row, samples: SampleSet[], singleDataset: boolean) {
  const tr = node('tr', '', row.rank === 1 ? 'first-place' : row.rank === null ? 'unranked' : '');
  tr.append(node('td', row.rank === null ? '—' : String(row.rank), 'rank-cell'));
  const modelCell = node('td');
  const modelLink = node('a', row.model.name, 'model-name');
  modelLink.href = row.model.reference;
  modelCell.append(modelLink, node('span', row.model.family, 'model-detail'));
  const warnings = warningMessages([...row.model.warnings, ...row.results.flatMap((result) => result.warnings)]);
  if (warnings.length) {
    const caveats = node('details', '', 'model-caveats');
    caveats.append(node('summary', `Caveats (${warnings.length})`));
    const list = node('ul');
    list.append(...warnings.map((message) => node('li', message)));
    caveats.append(list);
    modelCell.append(caveats);
  }
  tr.append(modelCell);
  for (const key of ['cer', 'wer'] as Metric[]) tr.append(node('td', row.metrics ? percent(row.metrics[key]) : '—', 'number-cell'));
  const coverage = node('td', row.status === 'not-supported' ? '—' : `${row.coverage}/${samples.length}`, 'coverage-cell');
  const recorded = row.results.reduce((sum, result) => sum + result.completed_samples, 0);
  const selected = samples.reduce((sum, sample) => sum + sample.selected_samples, 0);
  coverage.append(node('span', row.status === 'not-supported' ? 'task unavailable' : `${numbers.format(recorded)}/${numbers.format(selected)} ${task === 'line-recognition' ? 'lines' : 'pages'}`, 'coverage-detail'));
  tr.append(coverage);
  const failed = row.results.reduce((sum, result) => sum + result.failed_samples, 0);
  const failures = node('td', row.status === 'not-supported' ? '—' : numbers.format(failed), 'number-cell');
  failures.title = 'Failed attempts remain empty predictions in CER/WER; they are not retried.';
  tr.append(failures);
  const statusCell = node('td');
  const labels: Record<string, string> = { completed: 'Complete', running: 'Running', failed: 'Failed', blocked: 'Blocked', pending: 'Pending', 'not-supported': 'Not supported' };
  const badge = node('span', labels[row.status], `status-badge ${row.status}`);
  badge.title = row.status === 'not-supported' ? 'This model does not support the selected task.' : singleDataset ? `${recorded} of ${selected} samples attempted; ${failed} failed. Complete means every sample was attempted.` : `${row.coverage} of ${samples.length} selected datasets completed; ${failed} failed sample attempts remain scored. Partial results are not ranked.`;
  statusCell.append(badge);
  tr.append(statusCell);
  return tr;
}

function renderProvenance(selectedDatasets: Dataset[], samples: SampleSet[]) {
  const container = element('dataset-provenance');
  container.replaceChildren();
  for (const item of selectedDatasets) {
    const sample = samples.find((set) => set.dataset_id === item.id)!;
    const section = node('div', '', 'dataset-provenance-item');
    const heading = node('h3');
    const link = node('a', item.label);
    link.href = item.source_url;
    heading.append(link);
    section.append(heading, node('p', `${numbers.format(sample.selected_samples)} ${task === 'line-recognition' ? 'lines' : 'pages'} · ${item.language_codes.join(' / ').toUpperCase()} · ${item.document_type}`));
    section.append(node('p', `${sample.reference_type.replaceAll('_', ' ')} · Split: ${sample.split ?? 'not recorded'}`));
    section.append(node('p', sample.sampling_method));
    const provenance = node('dl');
    provenance.append(node('dt', 'Source revision'), node('dd', sample.source_revision ?? 'not recorded'), node('dt', 'Sample manifest'), node('dd', sample.manifest_sha256));
    section.append(provenance);
    const warnings = warningMessages(item.warnings);
    if (warnings.length) {
      const list = node('ul');
      list.append(...warnings.map((message) => node('li', message)));
      section.append(list);
    }
    container.append(section);
  }
  if (selectedDatasets.length === 0) container.append(node('p', 'No datasets match the current filters.'));
}

function render() {
  const selectedDatasets = matchingDatasets().filter((item) => dataset.value === 'all' || item.id === dataset.value);
  const samples = data.sample_sets.filter((sample) => sample.task === task && selectedDatasets.some((item) => item.id === sample.dataset_id));
  const rankedMetric = metric.value as Metric;
  const rows = data.models.map((model) => modelRow(model, samples)).sort((a, b) => {
    if (a.metrics && b.metrics) return a.metrics[rankedMetric] - b.metrics[rankedMetric] || a.model.name.localeCompare(b.model.name);
    if (a.metrics) return -1;
    if (b.metrics) return 1;
    return a.model.name.localeCompare(b.model.name);
  });
  let previousScore: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (row.metrics) {
      const score = row.metrics[rankedMetric];
      row.rank = score === previousScore ? previousRank : index + 1;
      previousRank = row.rank;
      previousScore = score;
    }
  });
  const query = search.value.trim().toLowerCase();
  const visible = rows.filter((row) => `${row.model.name} ${row.model.id} ${row.model.family}`.toLowerCase().includes(query));
  body.replaceChildren(...(samples.length ? visible.map((row) => renderRow(row, samples, dataset.value !== 'all')) : []));
  text('leaderboard-title', data.tasks.find((item) => item.id === task)!.label);
  text('dataset-count', `${samples.length} dataset${samples.length === 1 ? '' : 's'}`);
  const selectedSamples = samples.reduce((sum, sample) => sum + sample.selected_samples, 0);
  text('selection-description', `${numbers.format(selectedSamples)} frozen ${task === 'line-recognition' ? 'lines' : 'pages'} · ${dataset.value === 'all' ? 'Equal weight per dataset' : selectedDatasets[0].label} · Lower ${rankedMetric.toUpperCase()} is better`);
  text('visible-models', `${visible.length} model${visible.length === 1 ? '' : 's'}`);
  text('scoring-note', (dataset.value === 'all' ? 'All-dataset scores are unweighted means of corpus CER / WER, not pooled scores. Only full-coverage models are ranked.' : 'Scores are corpus CER / WER for this dataset. Only completed runs are ranked.') + ' Failed attempts count as empty predictions. Error rates may exceed 100%.');
  for (const key of ['cer', 'wer']) {
    const heading = element(`${key}-heading`);
    heading.textContent = `${key.toUpperCase()}${key === rankedMetric ? ' ↓' : ''}`;
    if (key === rankedMetric) heading.setAttribute('aria-sort', 'ascending');
    else heading.removeAttribute('aria-sort');
  }
  const status = element('table-status');
  status.hidden = samples.length > 0 && visible.length > 0;
  status.textContent = samples.length === 0 ? 'No datasets match these filters. Try another language or document type.' : 'No models match your search.';
  renderProvenance(selectedDatasets, samples);
}

function renderSnapshot() {
  const counts = data.run.counts;
  text('stat-models', numbers.format(counts.models));
  text('stat-datasets', numbers.format(counts.datasets));
  text('stat-tasks', String(data.tasks.length));
  text('stat-predictions', numbers.format(counts.recorded_samples));
  text('completion-label', `${counts.completed} / ${counts.jobs} evaluations completed`);
  const progress = counts.completed / counts.jobs * 100;
  text('completion-percent', `${Math.round(progress)}%`);
  element('progress-fill').style.width = `${progress}%`;
  element('progress').setAttribute('aria-valuenow', String(Math.round(progress)));
  const date = new Date(data.generated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  text('snapshot-date', `Snapshot: ${date} UTC · not a live feed`);
  text('metric-policy', data.run.metric_policy);
  const warnings = [...data.run.warnings, ...data.models.flatMap((model) => model.warnings),
    ...data.datasets.flatMap((item) => item.warnings), ...data.results.flatMap((result) => result.warnings)];
  element('warning-list').replaceChildren(...warningMessages(warnings).map((message) => node('li', message)));
  const provenance = element('run-provenance');
  for (const [label, value] of [['Runs', data.run.id], ['Code revisions', data.run.git_commit], ['Sampling seed', String(data.run.seed)], ['Other registered models', `${data.run.excluded_model_count} not evaluated in these runs`], ['Sample attempts', `${numbers.format(counts.recorded_samples)} total · ${numbers.format(counts.failed_samples)} failed (included in scores)`], ['Run status', `${counts.running} running · ${counts.pending} pending · ${counts.failed} failed · ${counts.blocked} blocked`]]) {
    provenance.append(node('dt', label), node('dd', value));
  }
}

async function start() {
  const response = await fetch('/ocr-eval/results.json');
  if (!response.ok) throw new Error(`Results request failed (${response.status}).`);
  data = await response.json();
  renderSnapshot();
  updateDatasetOptions();
  render();
  taskButtons.forEach((button) => button.addEventListener('click', () => {
    task = button.dataset.task!;
    taskButtons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    updateDatasetOptions();
    render();
  }));
  for (const filter of [language, documentType]) filter.addEventListener('change', () => { updateDatasetOptions(); render(); });
  dataset.addEventListener('change', render);
  metric.addEventListener('change', render);
  search.addEventListener('input', render);
}

start().catch((error: Error) => {
  const message = element('load-error');
  message.hidden = false;
  message.textContent = `The results snapshot could not be loaded. ${error.message} You can retry or download the results JSON above.`;
  element('table-status').hidden = true;
  text('completion-label', 'Snapshot unavailable');
});
