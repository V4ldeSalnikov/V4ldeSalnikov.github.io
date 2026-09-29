import { rankModels, type Snapshot, type Metric } from '../lib/ocr-results';
import { DEFAULT_MODELS, validModels, wordDiff } from '../lib/ocr-compare';
import { datasetDescriptions, languageNames } from '../data/ocr-datasets';

type ExampleIndex = { groups: { sample_set_id: string; dataset_id: string; task: string; examples: { id: string; case_id: string }[] }[] };
type Prediction = { text: string; cer: number; wer: number; inference_status: string };
type Example = { id: string; case_id: string; sample_set_id: string; image_url: string; reference: string; predictions: Record<string, Prediction>; attribution: { creator: string; source_url: string; license: string; license_url: string; changes: string; document_url?: string } };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const task = el<HTMLSelectElement>('compare-task');
const language = el<HTMLSelectElement>('compare-language');
const documentType = el<HTMLSelectElement>('compare-type');
const dataset = el<HTMLSelectElement>('example-dataset');
const caseSelect = el<HTMLSelectElement>('example-case');
const slots = [...document.querySelectorAll<HTMLSelectElement>('[data-model-slot]')];
const highlight = el<HTMLInputElement>('highlight-differences');
const sync = el<HTMLInputElement>('sync-scroll');
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-compare-metric]')];
let data: Snapshot, index: ExampleIndex;
let models: string[] = [], view = 'scores', metric: Metric = 'cer';
let currentExample: Example | null = null, requestId = 0;
const cache = new Map<string, Promise<Example>>();
const expanded = new Set<string>();
const percent = (value: number) => `${(100 * value).toFixed(2)}%`;
const name = (id: string) => id.split('/').slice(1).join('/') || id;
const datasetName = (id: string) => datasetDescriptions[id]?.name ?? id;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const item = document.createElement(tag); item.textContent = text; item.className = className; return item;
}
function link(text: string, href: string) { const item = node('a', text); item.href = href; return item; }

function matchingDatasets() {
  return data.datasets.filter(item => item.tasks.includes(task.value)
    && (language.value === 'all' || item.language_codes.includes(language.value))
    && (documentType.value === 'all' || item.document_type === documentType.value));
}
function currentGroup() { return index.groups.find(group => group.dataset_id === dataset.value && group.task === task.value); }
function updateExamples(preferredDataset = dataset.value, preferredCase = caseSelect.value) {
  const matching = matchingDatasets();
  dataset.replaceChildren(...matching.map(item => new Option(datasetName(item.id), item.id)));
  dataset.value = matching.some(item => item.id === preferredDataset) ? preferredDataset : matching[0]?.id ?? '';
  const cases = currentGroup()?.examples ?? [];
  caseSelect.replaceChildren(...cases.map((item, i) => new Option(`Example ${i + 1} of ${cases.length}`, item.id)));
  caseSelect.value = cases.some(item => item.id === preferredCase) ? preferredCase : cases[0]?.id ?? '';
  caseSelect.disabled = !cases.length;
  const position = cases.findIndex(item => item.id === caseSelect.value);
  el<HTMLButtonElement>('previous-example').disabled = position <= 0;
  el<HTMLButtonElement>('next-example').disabled = position < 0 || position >= cases.length - 1;
}
function renderPickers() {
  slots.forEach((slot, position) => {
    slot.replaceChildren(new Option(position === 2 ? 'Add a third model' : 'Choose a model', ''));
    for (const model of [...data.models].sort((a, b) => a.name.localeCompare(b.name))) {
      const option = new Option(model.name, model.id);
      option.disabled = models.includes(model.id) && models[position] !== model.id;
      slot.add(option);
    }
    slot.value = models[position] ?? ''; slot.disabled = false;
  });
}
function saveSelection() {
  const params = new URLSearchParams();
  models.forEach(id => params.append('model', id));
  params.set('task', task.value);
  if (language.value !== 'all') params.set('language', language.value);
  if (documentType.value !== 'all') params.set('type', documentType.value);
  if (view !== 'scores') params.set('view', view);
  if (metric !== 'cer') params.set('metric', metric);
  if (dataset.value) params.set('dataset', dataset.value);
  if (caseSelect.value) params.set('example', caseSelect.value);
  if (!highlight.checked) params.set('highlight', 'off');
  history.replaceState(null, '', `${location.pathname}?${params}`);
}
function renderScores() {
  const datasets = matchingDatasets();
  const samples = data.sample_sets.filter(sample => sample.task === task.value && datasets.some(item => item.id === sample.dataset_id));
  const header = node('tr'); header.append(node('th', 'Dataset'));
  for (const id of models) {
    const cell = node('th'); cell.append(link(name(id), data.models.find(model => model.id === id)!.reference));
    cell.append(node('small', metric.toUpperCase())); header.append(cell);
  }
  el('comparison-head').replaceChildren(header);
  const rows = datasets.map(item => {
    const row = node('tr'); const heading = node('td');
    const button = node('button', datasetName(item.id), 'dataset-score-link'); button.type = 'button';
    button.addEventListener('click', () => { view = 'examples'; updateExamples(item.id, ''); render(); });
    heading.append(button, node('small', item.language_codes.map(code => languageNames[code]).join(' / '))); row.append(heading);
    const values = models.map(id => data.results.find(result => result.model_id === id && result.sample_set_id === `${task.value}/${item.id}` && result.status === 'completed')?.corpus_metrics?.[metric]);
    appendScores(row, values); return row;
  });
  if (datasets.length > 1) {
    const aggregates = rankModels(data, samples, task.value, metric);
    const row = node('tr', '', 'mean-row'); row.append(node('td', 'Mean across datasets'));
    appendScores(row, models.map(id => aggregates.find(item => item.model.id === id)?.metrics[metric])); rows.push(row);
  }
  el('comparison-body').replaceChildren(...rows);
  el('score-summary').textContent = !models.length ? 'Choose models above to compare.' : `${models.length} models · ${datasets.length} datasets · ${metric.toUpperCase()} (%)`;
  metricButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.compareMetric === metric)));
}
function appendScores(row: HTMLTableRowElement, values: (number | undefined)[]) {
  const best = Math.min(...values.filter((value): value is number => value !== undefined && Number.isFinite(value)));
  for (const value of values) {
    const cell = node('td', value === undefined ? '—' : percent(value), value === best && values.length > 1 ? 'best-score' : '');
    if (value === undefined) cell.title = 'No comparable result for this model and selection.';
    row.append(cell);
  }
}
async function copy(text: string, button: HTMLButtonElement) {
  const previous = button.textContent;
  try { await navigator.clipboard.writeText(text); button.textContent = 'Copied'; }
  catch { button.textContent = 'Copy unavailable'; }
  window.setTimeout(() => { button.textContent = previous; }, 1800);
}
function renderPredictions() {
  if (!currentExample) return;
  const example = currentExample;
  const grid = el('prediction-grid'); grid.style.setProperty('--model-count', String(Math.max(1, models.length)));
  grid.classList.toggle('line-outputs', task.value === 'line-recognition');
  el('diff-legend').hidden = !highlight.checked;
  grid.replaceChildren(...models.map(id => {
    const card = node('article', '', 'prediction-card');
    const header = node('header'); const title = node('h3'); title.append(link(name(id), data.models.find(model => model.id === id)!.reference));
    const prediction = example.predictions[id]; const metadata = node('div');
    metadata.append(node('span', prediction ? `CER ${percent(prediction.cer)} · WER ${percent(prediction.wer)}` : 'No saved result for this task'));
    if (prediction) {
      const button = node('button', 'Copy', 'text-button'); button.type = 'button'; button.setAttribute('aria-label', `Copy ${name(id)} prediction`);
      button.addEventListener('click', () => void copy(prediction.text, button)); metadata.append(button);
    }
    header.append(title, metadata); card.append(header);
    const output = node('div', '', 'output-text'); output.tabIndex = 0; output.setAttribute('aria-label', `${name(id)} prediction`);
    if (!prediction) output.append(node('span', 'This model was not evaluated on this task.', 'empty-output'));
    else if (!prediction.text) output.append(node('span', prediction.inference_status === 'failed' ? 'No text returned — this attempt failed and was scored as an empty prediction.' : 'The model returned an empty prediction.', 'empty-output'));
    else {
      const long = prediction.text.length > 12000 && !expanded.has(id);
      if (highlight.checked && !long) {
        for (const piece of wordDiff(example.reference, prediction.text)) {
          const part = node(piece.kind === 'insert' ? 'ins' : piece.kind === 'delete' ? 'del' : 'span', piece.text);
          if (piece.kind !== 'equal') part.title = piece.kind === 'insert' ? 'Text added or changed by the model' : 'Reference text missing from the model output';
          output.append(part, document.createTextNode(' '));
        }
      } else output.textContent = long ? prediction.text.slice(0, 12000) : prediction.text;
      if (long) {
        const footer = node('footer'); const button = node('button', 'Show full output', 'text-button'); button.type = 'button';
        button.addEventListener('click', () => { expanded.add(id); renderPredictions(); });
        footer.append(node('span', 'Long output · showing the first 12,000 characters. '), button); card.append(output, footer); return card;
      }
    }
    card.append(output); return card;
  }));
  connectScrolling();
}
function connectScrolling() {
  const panes = [...document.querySelectorAll<HTMLElement>('.output-text')];
  let active: HTMLElement | null = null;
  for (const pane of panes) {
    // Only the pane the reader operates drives scrolling; programmatic events cannot feed back.
    const activate = () => { active = pane; };
    pane.onwheel = activate; pane.ontouchstart = activate; pane.onpointerdown = activate; pane.onkeydown = activate;
    pane.onscroll = () => {
      if (!sync.checked || active !== pane) return;
      const range = pane.scrollHeight - pane.clientHeight;
      if (range <= 0) return;
      const fraction = pane.scrollTop / range;
      for (const other of panes) if (other !== pane) other.scrollTop = fraction * (other.scrollHeight - other.clientHeight);
    };
  }
}
async function renderExample() {
  const ticket = ++requestId;
  currentExample = null; el('example-content').hidden = true;
  const message = el('example-message'); message.hidden = false;
  if (!caseSelect.value) {
    message.textContent = matchingDatasets().length ? 'No published examples for this dataset yet. Choose another dataset to inspect outputs.' : 'No datasets match these filters.';
    return;
  }
  message.textContent = 'Loading example…';
  const identifier = caseSelect.value;
  try {
    if (!cache.has(identifier)) cache.set(identifier, fetch(`/ocr-eval/examples/${identifier}.json`).then(async response => {
      if (!response.ok) throw new Error('Example unavailable'); return await response.json() as Example;
    }).catch(error => { cache.delete(identifier); throw error; }));
    const example = await cache.get(identifier)!;
    if (ticket !== requestId) return;
    if (example.id !== identifier || example.sample_set_id !== `${task.value}/${dataset.value}`) throw new Error('Example selection mismatch');
    currentExample = example; expanded.clear();
    const image = el<HTMLImageElement>('example-image'); image.src = example.image_url; image.alt = `${datasetName(dataset.value)} — ${example.case_id}`; image.style.width = '100%';
    image.parentElement!.classList.toggle('line-image', task.value === 'line-recognition');
    image.closest('.source-grid')!.classList.toggle('line-example', task.value === 'line-recognition');
    el<HTMLInputElement>('image-zoom').value = '100';
    el<HTMLAnchorElement>('open-image').href = example.image_url;
    el('reference-text').textContent = example.reference;
    const attribution = el('example-attribution'); const details = example.attribution;
    const source = node('p'); source.append(link('Source dataset ↗', details.source_url), link(details.license, details.license_url));
    if (details.document_url) source.append(link('Original publication ↗', details.document_url));
    attribution.replaceChildren(node('code', example.case_id), node('p', details.creator), source, node('p', details.changes));
    renderPredictions(); el('example-content').hidden = false; message.hidden = true;
  } catch {
    if (ticket === requestId) message.textContent = 'This example could not be loaded. Choose another example or reload the page.';
  }
}
function render() {
  renderPickers(); renderScores();
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  el('scores-panel').hidden = view !== 'scores'; el('examples-panel').hidden = view !== 'examples';
  if (view === 'examples') void renderExample(); else { requestId++; currentExample = null; }
  saveSelection();
}
function restore() {
  const params = new URLSearchParams(location.search);
  const available = data.models.map(model => model.id);
  models = validModels(params.getAll('model'), available);
  if (!models.length) models = validModels(DEFAULT_MODELS, available);
  task.value = params.get('task') === 'page-transcription' ? 'page-transcription' : 'line-recognition';
  language.value = ['da', 'no', 'sv'].includes(params.get('language') ?? '') ? params.get('language')! : 'all';
  documentType.value = ['handwritten', 'printed'].includes(params.get('type') ?? '') ? params.get('type')! : 'all';
  view = params.get('view') === 'examples' ? 'examples' : 'scores';
  metric = params.get('metric') === 'wer' ? 'wer' : 'cer'; highlight.checked = params.get('highlight') !== 'off';
  updateExamples(params.get('dataset') ?? 'modern-danish', params.get('example') ?? ''); render();
}
async function start() {
  [data, index] = await Promise.all(['/ocr-eval/results.json', '/ocr-eval/examples/index.json'].map(async url => {
    const response = await fetch(url); if (!response.ok) throw new Error('Results unavailable'); return response.json();
  }));
  restore();
  slots.forEach(slot => slot.addEventListener('change', () => { models = validModels(slots.map(item => item.value), data.models.map(model => model.id)); render(); }));
  for (const control of [task, language, documentType]) control.addEventListener('change', () => { updateExamples(); render(); });
  viewButtons.forEach(button => button.addEventListener('click', () => { view = button.dataset.view!; render(); }));
  metricButtons.forEach(button => button.addEventListener('click', () => { metric = button.dataset.compareMetric as Metric; renderScores(); saveSelection(); }));
  dataset.addEventListener('change', () => { updateExamples(dataset.value, ''); void renderExample(); saveSelection(); });
  caseSelect.addEventListener('change', () => { updateExamples(); void renderExample(); saveSelection(); });
  for (const [id, delta] of [['previous-example', -1], ['next-example', 1]] as const) el(id).addEventListener('click', () => {
    const cases = currentGroup()?.examples ?? []; const position = cases.findIndex(item => item.id === caseSelect.value);
    if (cases[position + delta]) { updateExamples(dataset.value, cases[position + delta].id); void renderExample(); saveSelection(); }
  });
  highlight.addEventListener('change', () => { renderPredictions(); saveSelection(); });
  el<HTMLInputElement>('image-zoom').addEventListener('input', event => { el('example-image').style.width = `${(event.target as HTMLInputElement).value}%`; });
  el<HTMLButtonElement>('copy-reference').addEventListener('click', event => { if (currentExample) void copy(currentExample.reference, event.currentTarget as HTMLButtonElement); });
  el<HTMLButtonElement>('share-comparison').addEventListener('click', event => void copy(location.href, event.currentTarget as HTMLButtonElement));
  window.addEventListener('popstate', restore);
}
start().catch(() => { const message = el('compare-error'); message.hidden = false; message.textContent = 'The comparison could not be loaded. Please reload the page.'; });
