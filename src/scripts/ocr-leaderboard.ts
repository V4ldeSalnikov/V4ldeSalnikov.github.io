import { rankModels, type Metric, type Snapshot, type Row } from '../lib/ocr-results';
import { datasetDescriptions } from '../data/ocr-datasets';
import { benchmarks, inputDescription } from '../data/ocr-benchmarks';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const search = element<HTMLInputElement>('model-search');
const body = element<HTMLTableSectionElement>('results-body');
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-metric]')];
const scoreLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-score-sample]')];
let benchmark = benchmarks[0], selectedSample = '', metric: Metric = 'cer';
let data: Snapshot;
const numbers = new Intl.NumberFormat('en-GB');
const percent = (value: number) => `${(value * 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const text = (id: string, value: string) => { element(id).textContent = value; };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') {
  const result = document.createElement(tag);
  result.textContent = value; result.className = className; return result;
}

function renderRow(row: Row) {
  const tr = node('tr', '', row.rank === 1 ? 'first-place' : '');
  tr.append(node('td', String(row.rank), 'rank-cell'));
  const modelCell = node('td');
  const [publisher, ...name] = row.model.name.split('/');
  const modelLink = node('a', name.length ? name.join('/') : publisher, 'model-name');
  modelLink.href = row.model.reference; modelLink.title = row.model.id;
  modelCell.append(modelLink);
  if (name.length) modelCell.append(node('span', publisher, 'model-publisher'));
  tr.append(modelCell);
  for (const key of ['cer', 'wer'] as Metric[]) tr.append(node('td', percent(row.metrics[key]), 'number-cell'));
  return tr;
}

function saveSelection() {
  const params = new URLSearchParams({ benchmark: benchmark.id });
  if (selectedSample) params.set('sample', selectedSample);
  if (metric !== 'cer') params.set('metric', metric);
  if (search.value.trim()) params.set('q', search.value.trim());
  history.replaceState(null, '', `${location.pathname}?${params}${location.hash}`);
}

function render() {
  const samples = data.sample_sets.filter(sample => benchmark.sampleIds.includes(sample.id) && (!selectedSample || sample.id === selectedSample));
  const rows = rankModels(data, samples, null, metric);
  const query = search.value.trim().toLowerCase();
  const visible = rows.filter(row => `${row.model.name} ${row.model.id} ${row.model.family}`.toLowerCase().includes(query));
  body.replaceChildren(...visible.map(renderRow));
  const sample = selectedSample ? samples[0] : undefined;
  text('selected-benchmark', sample ? datasetDescriptions[sample.dataset_id]?.name ?? sample.dataset_id : benchmark.name);
  text('selected-task', sample ? inputDescription(sample.task) : '');
  element('selected-task').hidden = !sample;
  for (const link of scoreLinks) {
    const id = link.dataset.scoreSample!;
    const params = new URLSearchParams({ benchmark: benchmark.id });
    if (id) params.set('sample', id);
    if (metric !== 'cer') params.set('metric', metric);
    if (search.value.trim()) params.set('q', search.value.trim());
    link.href = `?${params}#leaderboard`;
    if (id === selectedSample) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
  document.querySelectorAll<HTMLElement>('[data-score-dataset]').forEach(item => {
    item.hidden = !data.sample_sets.some(sample => sample.dataset_id === item.dataset.scoreDataset && benchmark.sampleIds.includes(sample.id));
  });
  const count = samples.reduce((sum, sample) => sum + sample.selected_samples, 0);
  text('selection-description', `${samples.length} task${samples.length === 1 ? '' : 's'}${sample ? '' : ' · equal-weight mean'} · ${numbers.format(count)} images`);
  const about = element<HTMLAnchorElement>('benchmark-about');
  about.href = sample ? `/ocr-eval/datasets/#${sample.dataset_id}` : `/ocr-eval/benchmarks/${benchmark.id}/`;
  about.textContent = sample ? 'About this dataset ↗' : 'About this benchmark ↗';
  text('visible-models', `${visible.length} model${visible.length === 1 ? '' : 's'}`);
  document.querySelectorAll<HTMLElement>('[data-benchmark-card]').forEach(card => { card.dataset.selected = String(card.dataset.benchmarkCard === benchmark.id); });
  document.querySelectorAll<HTMLAnchorElement>('[data-benchmark]').forEach(link => {
    if (link.dataset.benchmark === benchmark.id) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  for (const button of metricButtons) {
    const active = button.dataset.metric === metric;
    const heading = button.closest('th')!;
    if (active) heading.setAttribute('aria-sort', 'ascending'); else heading.removeAttribute('aria-sort');
    button.querySelector('[data-sort-arrow]')!.textContent = active ? '↓' : '↕';
  }
  const status = element('table-status');
  status.hidden = visible.length > 0;
  status.textContent = !rows.length ? 'No models have scores for every task in this benchmark.' : 'No models match your search.';
  saveSelection();
}

function restoreSelection() {
  const params = new URLSearchParams(location.search);
  // Keep existing dataset links usable while replacing the old filter-based navigation.
  const legacyLanguage = params.get('language') ?? data.datasets.find(dataset => dataset.id === params.get('dataset'))?.language_codes[0];
  benchmark = benchmarks.find(item => item.id === params.get('benchmark'))
    ?? benchmarks.find(item => item.languages.length === 1 && item.languages[0] === legacyLanguage) ?? benchmarks[0];
  const requestedSample = params.get('sample') ?? `${params.get('task') ?? 'line-recognition'}/${params.get('dataset') ?? ''}`;
  selectedSample = benchmark.sampleIds.includes(requestedSample) ? requestedSample : '';
  metric = params.get('metric') === 'wer' ? 'wer' : 'cer';
  search.value = params.get('q') ?? '';
  render();
}

async function start() {
  const response = await fetch('/ocr-eval/results.json');
  if (!response.ok) throw new Error(`Results request failed (${response.status}).`);
  data = await response.json(); restoreSelection();
  metricButtons.forEach(button => button.addEventListener('click', () => { metric = button.dataset.metric as Metric; render(); }));
  search.addEventListener('input', render);
  scoreLinks.forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    history.pushState(null, '', link.href);
    restoreSelection();
    // Keep the scores visible when dataset navigation sits above them on small screens.
    if (window.matchMedia('(max-width: 1000px)').matches) element('leaderboard').scrollIntoView();
  }));
  window.addEventListener('popstate', restoreSelection);
}

start().catch(() => {
  const message = element('load-error'); message.hidden = false;
  message.textContent = 'The results could not be loaded. Please reload the page, or use the results download below.';
  element('table-status').hidden = true; text('selection-description', 'Results unavailable');
});
