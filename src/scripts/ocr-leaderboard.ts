import { type Metric, type SampleSet, type Snapshot } from '../lib/ocr-results';
import { matrixRows, type Aggregation, type MatrixRow } from '../lib/ocr-matrix';
import { datasetDescriptions } from '../data/ocr-datasets';
import { benchmarks, inputDescription } from '../data/ocr-benchmarks';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const search = element<HTMLInputElement>('model-search');
const benchmarkSelect = element<HTMLSelectElement>('benchmark-select');
const aggregationSelect = element<HTMLSelectElement>('aggregation-select');
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-metric]')];
let data: Snapshot, benchmark = benchmarks[0], metric: Metric = 'wer', aggregation: Aggregation = 'mean';
let sortKey = 'overall', descending = false;
const number = (value: number) => value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = (value: number) => `${number(value * 100)}%`;
const text = (id: string, value: string) => { element(id).textContent = value; };
const explanations: Record<Aggregation, string> = {
  mean: 'Mean averages the selected error rate across tasks, giving every task equal weight. Lower is better.',
  borda: 'Borda rank averages a model’s position on each task. Ties share the average position. Lower is better.',
  'win-rate': 'Win rate estimates how often a model beats another model, using Bradley–Terry comparisons of task scores. Ties count as half a win. Higher is better.',
};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') {
  const item = document.createElement(tag); item.textContent = value; item.className = className; return item;
}
function overallLabel() { return aggregation === 'mean' ? `Mean ${metric.toUpperCase()}` : aggregation === 'borda' ? 'Borda rank' : 'Win rate'; }
function saveSelection(push = false) {
  const params = new URLSearchParams({ benchmark: benchmark.id, metric, aggregation });
  if (sortKey !== 'overall') params.set('sort', sortKey);
  if (descending !== (sortKey === 'overall' && aggregation === 'win-rate')) params.set('direction', descending ? 'desc' : 'asc');
  if (search.value.trim()) params.set('q', search.value.trim());
  history[push ? 'pushState' : 'replaceState'](null, '', `${location.pathname}?${params}${location.hash}`);
}
function heading(key: string, label: string, subtitle: string, className: string, description = '', href = '') {
  const cell = node('th', '', className); cell.scope = 'col';
  const button = node('button'); button.type = 'button'; button.dataset.sort = key;
  if (href) {
    const link = node('a', label, 'dataset-heading'); link.href = href;
    link.title = `Read about ${label}`; cell.append(link);
    button.className = 'task-sort';
  }
  button.append(node('span', href ? subtitle : label));
  const active = key === sortKey;
  button.append(node('span', active ? (descending ? '↓' : '↑') : '↕', 'sort-arrow'));
  if (!href) button.append(node('small', subtitle));
  button.title = description || `Sort by ${label}`;
  button.setAttribute('aria-label', href ? `Sort by ${metric.toUpperCase()}: ${label}, ${subtitle}` : `Sort by ${label}, ${subtitle}`);
  if (active) cell.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
  button.addEventListener('click', () => {
    descending = active ? !descending : key === 'overall' && aggregation === 'win-rate';
    sortKey = key; render(); saveSelection(true);
  });
  cell.append(button); return cell;
}
function renderRow(row: MatrixRow, samples: SampleSet[], columns: Record<string, number[]>) {
  const tr = node('tr'); tr.dataset.model = row.model.id;
  const model = node('td', '', 'model-cell');
  const [publisher, ...parts] = row.model.name.split('/');
  const link = node('a', parts.length ? parts.join('/') : publisher, 'model-name');
  link.href = row.model.reference; link.title = row.model.id; model.append(link);
  if (parts.length) model.append(node('span', publisher, 'model-publisher'));
  const overall = node('td', row.aggregate === null ? '—' : aggregation === 'borda' ? number(row.aggregate) : percent(row.aggregate), 'overall-cell');
  if (row.aggregate === null) overall.title = aggregation === 'win-rate' && samples.every(sample => row.scores[sample.id] !== null)
    ? 'Win rate needs at least two fully evaluated models.' : 'An overall score requires a completed evaluation on every task in this benchmark.';
  tr.append(model, overall);
  for (const sample of samples) {
    const value = row.scores[sample.id];
    const cell = node('td', '', sortKey === sample.id ? 'selected-task' : ''); cell.dataset.sample = sample.id;
    if (value === null) { cell.textContent = '—'; cell.classList.add('missing-score'); cell.title = 'No completed score for this task.'; }
    else {
      const scores = columns[sample.id];
      const position = scores.filter(score => score < value).length / Math.max(1, scores.length - 1);
      cell.style.backgroundColor = `rgba(190, 37, 56, ${position * .16})`;
      if (value === Math.min(...scores)) cell.classList.add('best-score');
      const params = new URLSearchParams({ model: row.model.id, view: 'examples', metric, task: sample.task, dataset: sample.dataset_id });
      const score = node('a', percent(value)); score.href = `/ocr-eval/compare/?${params}`;
      score.title = `View ${metric.toUpperCase()} ${percent(value)} examples: ${datasetDescriptions[sample.dataset_id].name}`;
      cell.append(score);
    }
    tr.append(cell);
  }
  return tr;
}
function render() {
  const samples = benchmark.sampleIds.map(id => data.sample_sets.find(sample => sample.id === id)!).filter(Boolean);
  const rows = matrixRows(data, samples, metric, aggregation);
  const columns = Object.fromEntries(samples.map(sample => [sample.id, rows.map(row => row.scores[sample.id]).filter((value): value is number => value !== null)]));
  const value = (row: MatrixRow) => sortKey === 'overall' ? row.aggregate : row.scores[sortKey];
  rows.sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return x == y ? a.model.name.localeCompare(b.model.name) : x == null ? 1 : -1;
    return (descending ? y - x : x - y) || a.model.name.localeCompare(b.model.name);
  });
  const query = search.value.trim().toLowerCase();
  const visible = rows.filter(row => `${row.model.name} ${row.model.id} ${row.model.family}`.toLowerCase().includes(query));
  const head = node('tr'); const model = node('th', 'Model', 'model-cell'); model.scope = 'col'; head.append(model);
  head.append(heading('overall', overallLabel(), aggregation === 'win-rate' ? 'Higher is better' : 'Lower is better', 'overall-cell'));
  for (const sample of samples) head.append(heading(sample.id, datasetDescriptions[sample.dataset_id].name,
    sample.task === 'line-recognition' ? 'Cropped lines' : 'Full pages', '',
    `${inputDescription(sample.task)} Sort by ${metric.toUpperCase()}.`, `/ocr-eval/datasets/#${sample.dataset_id}`));
  element('matrix-columns').replaceChildren(node('col', '', 'model-column'), node('col', '', 'overall-column'), ...samples.map(() => node('col')));
  element('results-head').replaceChildren(head);
  element('results-body').replaceChildren(...visible.map(row => renderRow(row, samples, columns)));
  const table = document.querySelector<HTMLTableElement>('.task-matrix')!;
  table.style.minWidth = `calc(var(--model-width) + var(--overall-width) + ${96 * samples.length}px)`;
  text('table-caption', `${benchmark.name}: ${overallLabel()} and ${metric.toUpperCase()} for each task. Task error rates are percentages; lower is better.`);
  text('selection-description', `${samples.length} tasks · ${metric.toUpperCase()} (%)`);
  text('metric-help', `${metric === 'wer' ? 'WER counts word' : 'CER counts character'} substitutions, deletions and insertions relative to the reference text. Lower is better; scores can exceed 100%.`);
  text('aggregation-help', explanations[aggregation]);
  text('visible-models', `${visible.length} model${visible.length === 1 ? '' : 's'}`);
  element<HTMLAnchorElement>('benchmark-about').href = `/ocr-eval/benchmarks/${benchmark.id}/`;
  benchmarkSelect.value = benchmark.id; aggregationSelect.value = aggregation;
  metricButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.metric === metric)));
  element('table-status').hidden = visible.length > 0;
  text('table-status', 'No models match your search.');
}
function restoreSelection() {
  const params = new URLSearchParams(location.search);
  const legacyLanguage = params.get('language') ?? data.datasets.find(dataset => dataset.id === params.get('dataset'))?.language_codes[0];
  benchmark = benchmarks.find(item => item.id === params.get('benchmark'))
    ?? benchmarks.find(item => item.languages.length === 1 && item.languages[0] === legacyLanguage) ?? benchmarks[0];
  metric = params.get('metric') === 'cer' ? 'cer' : 'wer';
  aggregation = ['borda', 'win-rate'].includes(params.get('aggregation') ?? '') ? params.get('aggregation') as Aggregation : 'mean';
  const requested = params.get('sort') ?? params.get('sample') ?? `${params.get('task') ?? 'line-recognition'}/${params.get('dataset') ?? ''}`;
  sortKey = benchmark.sampleIds.includes(requested) ? requested : 'overall';
  descending = params.has('direction') ? params.get('direction') === 'desc' : sortKey === 'overall' && aggregation === 'win-rate';
  search.value = params.get('q') ?? '';
  render(); saveSelection();
}
async function start() {
  const response = await fetch('/ocr-eval/results.json');
  if (!response.ok) throw new Error('Results could not be loaded.');
  data = await response.json(); restoreSelection();
  benchmarkSelect.addEventListener('change', () => { benchmark = benchmarks.find(item => item.id === benchmarkSelect.value)!; sortKey = 'overall'; descending = aggregation === 'win-rate'; render(); saveSelection(true); });
  aggregationSelect.addEventListener('change', () => { aggregation = aggregationSelect.value as Aggregation; sortKey = 'overall'; descending = aggregation === 'win-rate'; render(); saveSelection(true); });
  metricButtons.forEach(button => button.addEventListener('click', () => { metric = button.dataset.metric as Metric; render(); saveSelection(true); }));
  search.addEventListener('input', () => { render(); saveSelection(); });
  const help = document.querySelector<HTMLElement>('.score-help')!;
  help.addEventListener('keydown', event => {
    if (event.key === 'Escape') { help.querySelector<HTMLButtonElement>('button')!.focus(); help.classList.add('dismissed'); }
  });
  help.addEventListener('mouseenter', () => help.classList.remove('dismissed'));
  help.addEventListener('click', () => help.classList.remove('dismissed'));
  help.addEventListener('focusin', () => help.classList.remove('dismissed'));
  window.addEventListener('popstate', restoreSelection);
}
start().catch(() => {
  element('load-error').hidden = false;
  text('load-error', 'The results could not be loaded. Please reload the page or download the results below.');
  element('table-status').hidden = true;
});
