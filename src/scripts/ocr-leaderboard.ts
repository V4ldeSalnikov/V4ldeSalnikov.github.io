import { rankModels, type Metric, type Snapshot, type Row } from '../lib/ocr-results';
import { datasetDescriptions } from '../data/ocr-datasets';
import { MAX_MODELS, validModels } from '../lib/ocr-compare';

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const documentType = element<HTMLSelectElement>('document-type');
const dataset = element<HTMLSelectElement>('dataset');
const search = element<HTMLInputElement>('model-search');
const body = element<HTMLTableSectionElement>('results-body');
const taskButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-task]')];
const languageButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-language]')];
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-metric]')];
let task = 'line-recognition';
let language = 'all';
let metric: Metric = 'cer';
let data: Snapshot;
let selectedModels = new Set<string>();
const numbers = new Intl.NumberFormat('en-GB');
const percent = (value: number) => `${(value * 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const text = (id: string, value: string) => { element(id).textContent = value; };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') {
  const result = document.createElement(tag);
  result.textContent = value;
  result.className = className;
  return result;
}

function matchingDatasets() {
  return data.datasets.filter(item => item.tasks.includes(task)
    && (language === 'all' || item.language_codes.includes(language))
    && (documentType.value === 'all' || item.document_type === documentType.value));
}

function updateDatasetOptions(preferred = dataset.value) {
  dataset.replaceChildren(new Option('All datasets', 'all'));
  for (const item of matchingDatasets()) dataset.add(new Option(datasetDescriptions[item.id]?.name ?? item.label, item.id));
  dataset.value = [...dataset.options].some(option => option.value === preferred) ? preferred : 'all';
}

function renderRow(row: Row) {
  const tr = node('tr', '', row.rank === 1 ? 'first-place' : '');
  tr.append(node('td', String(row.rank), 'rank-cell'));
  const modelCell = node('td');
  const modelContent = node('div', '', 'model-cell-content');
  const selectModel = node('input'); selectModel.type = 'checkbox'; selectModel.value = row.model.id;
  selectModel.className = 'compare-checkbox'; selectModel.checked = selectedModels.has(row.model.id);
  selectModel.setAttribute('aria-label', `Compare ${row.model.name}`);
  selectModel.addEventListener('change', () => {
    if (selectModel.checked && selectedModels.size < MAX_MODELS) selectedModels.add(row.model.id);
    else selectedModels.delete(row.model.id);
    updateComparison(); saveSelection();
  });
  const modelDetails = node('div');
  const [publisher, ...name] = row.model.name.split('/');
  const modelLink = node('a', name.length ? name.join('/') : publisher, 'model-name');
  modelLink.href = row.model.reference;
  modelLink.title = row.model.id;
  modelDetails.append(modelLink);
  if (name.length) modelDetails.append(node('span', publisher, 'model-publisher'));
  modelContent.append(selectModel, modelDetails); modelCell.append(modelContent);
  tr.append(modelCell);
  for (const key of ['cer', 'wer'] as Metric[]) tr.append(node('td', percent(row.metrics[key]), 'number-cell'));
  return tr;
}

function saveSelection() {
  const params = new URLSearchParams();
  selectedModels.forEach(id => params.append('model', id));
  if (task !== 'line-recognition') params.set('task', task);
  if (language !== 'all') params.set('language', language);
  if (documentType.value !== 'all') params.set('type', documentType.value);
  if (dataset.value !== 'all') params.set('dataset', dataset.value);
  if (metric !== 'cer') params.set('metric', metric);
  if (search.value.trim()) params.set('q', search.value.trim());
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}

function updateComparison() {
  document.querySelectorAll<HTMLInputElement>('.compare-checkbox').forEach(input => {
    input.checked = selectedModels.has(input.value);
    input.disabled = !input.checked && selectedModels.size >= MAX_MODELS;
  });
  element('compare-tray').hidden = !selectedModels.size;
  text('compare-selection-count', `${selectedModels.size} / ${MAX_MODELS} models selected`);
  const params = new URLSearchParams({ task });
  selectedModels.forEach(id => params.append('model', id));
  if (language !== 'all') params.set('language', language);
  if (documentType.value !== 'all') params.set('type', documentType.value);
  if (dataset.value !== 'all') params.set('dataset', dataset.value);
  element<HTMLAnchorElement>('compare-selected').href = `/ocr-eval/compare/?${params}`;
}

function render() {
  const selected = matchingDatasets().filter(item => dataset.value === 'all' || item.id === dataset.value);
  const samples = data.sample_sets.filter(sample => sample.task === task && selected.some(item => item.id === sample.dataset_id));
  const rows = rankModels(data, samples, task, metric);
  const query = search.value.trim().toLowerCase();
  const visible = rows.filter(row => `${row.model.name} ${row.model.id} ${row.model.family}`.toLowerCase().includes(query));
  body.replaceChildren(...visible.map(renderRow));
  updateComparison();
  const count = samples.reduce((sum, sample) => sum + sample.selected_samples, 0);
  const label = dataset.value === 'all' ? `${samples.length} datasets · equal-weight average` : datasetDescriptions[dataset.value]?.name ?? selected[0]?.label ?? '';
  text('selection-description', `${label} · ${numbers.format(count)} ${task === 'line-recognition' ? 'lines' : 'pages'}`);
  text('visible-models', `${visible.length} model${visible.length === 1 ? '' : 's'}`);
  taskButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.task === task)));
  languageButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
  for (const button of metricButtons) {
    const active = button.dataset.metric === metric;
    const heading = button.closest('th')!;
    if (active) heading.setAttribute('aria-sort', 'ascending');
    else heading.removeAttribute('aria-sort');
    button.querySelector('[data-sort-arrow]')!.textContent = active ? '↓' : '↕';
  }
  const status = element('table-status');
  status.hidden = visible.length > 0;
  status.textContent = !samples.length ? 'No datasets match these filters. Try another document type or task.'
    : !rows.length ? 'No models have results for this selection.' : 'No models match your search.';
  saveSelection();
}

function restoreSelection() {
  const params = new URLSearchParams(location.search);
  selectedModels = new Set(validModels(params.getAll('model'), data.models.map(model => model.id)));
  task = params.get('task') === 'page-transcription' ? 'page-transcription' : 'line-recognition';
  language = ['da', 'no', 'sv'].includes(params.get('language') ?? '') ? params.get('language')! : 'all';
  documentType.value = ['printed', 'handwritten'].includes(params.get('type') ?? '') ? params.get('type')! : 'all';
  metric = params.get('metric') === 'wer' ? 'wer' : 'cer';
  search.value = params.get('q') ?? '';
  updateDatasetOptions(params.get('dataset') ?? 'all');
  render();
}

async function start() {
  const response = await fetch('/ocr-eval/results.json');
  if (!response.ok) throw new Error(`Results request failed (${response.status}).`);
  data = await response.json();
  restoreSelection();
  taskButtons.forEach(button => button.addEventListener('click', () => { task = button.dataset.task!; updateDatasetOptions(); render(); }));
  languageButtons.forEach(button => button.addEventListener('click', () => { language = button.dataset.language!; updateDatasetOptions(); render(); }));
  metricButtons.forEach(button => button.addEventListener('click', () => { metric = button.dataset.metric as Metric; render(); }));
  documentType.addEventListener('change', () => { updateDatasetOptions(); render(); });
  dataset.addEventListener('change', render);
  search.addEventListener('input', render);
  element('clear-comparison').addEventListener('click', () => { selectedModels.clear(); updateComparison(); saveSelection(); });
  element('reset-filters').addEventListener('click', () => { language = 'all'; documentType.value = 'all'; search.value = ''; metric = 'cer'; updateDatasetOptions('all'); render(); });
  window.addEventListener('popstate', restoreSelection);
}

start().catch(() => {
  const message = element('load-error');
  message.hidden = false;
  message.textContent = 'The results could not be loaded. Please reload the page, or use the results download below.';
  element('table-status').hidden = true;
  text('selection-description', 'Results unavailable');
});
