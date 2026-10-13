import type { Checks, Evidence, Openness, Status } from '../lib/ocr-openness';

// One evidence record for each evaluated model release.
const reviewed = '2026-10-13';
const hf = (id: string) => `https://huggingface.co/${id}`;
const evidence = (status: Status, note: string, ...sources: string[]): Evidence => ({ status, note, sources });
const unknown = (source: string, note: string) => evidence('unknown', note, source);
function model(source: string, overrides: Partial<Checks> = {}): Openness {
  return { reviewed, checks: {
    weights: unknown(source, 'A downloadable checkpoint has not been verified.'),
    license: unknown(source, 'A model license has not been verified.'),
    code: unknown(source, 'The code and complete training recipe for this model have not been verified.'),
    data: unknown(source, 'A complete public training corpus or reconstruction recipe has not been verified.'),
    paper: unknown(source, 'A technical paper about this model has not been verified.'),
    card: unknown(source, 'Model documentation has not been verified.'),
    ...overrides,
  } };
}
function release(id: string, license: string, paper?: string, overrides: Partial<Checks> = {}): Openness {
  const source = hf(id);
  return model(source, {
    weights: evidence('yes', 'Downloadable checkpoint files.', `${source}/tree/main`),
    license: evidence('yes', `${license} model license.`, source),
    card: evidence('yes', 'Public model card.', source),
    ...(paper ? { paper: evidence('yes', 'A technical report describes this model family.', paper) } : {}),
    ...overrides,
  });
}

export const modelOpenness: Record<string, Openness> = {
  'Riksarkivet/trocr-base-handwritten-hist-swe-2': release('Riksarkivet/trocr-base-handwritten-hist-swe-2', 'Apache-2.0', undefined, {
    data: evidence('partial', 'The card links public training datasets but explicitly states that not all training data can be released.', hf('Riksarkivet/trocr-base-handwritten-hist-swe-2')),
  }),
  'Sprakbanken/TrOCR-norhand-v3': release('Sprakbanken/TrOCR-norhand-v3', 'CC-BY-4.0', undefined, {
    data: evidence('yes', 'The card identifies NorHand v3 as the training dataset for this release and links its public version.', hf('Sprakbanken/TrOCR-norhand-v3'), 'https://huggingface.co/datasets/Teklia/NorHand-v3-line'),
  }),
  'stepfun-ai/GOT-OCR-2.0-hf': release('stepfun-ai/GOT-OCR-2.0-hf', 'Apache-2.0', 'https://arxiv.org/abs/2409.01704', {
    code: evidence('partial', 'The authors release training code using GOT weights. This does not establish a complete recipe for the evaluated checkpoint.', 'https://github.com/Ucas-HaoranWei/GOT-OCR2.0'),
  }),
  'zai-org/GLM-OCR': release('zai-org/GLM-OCR', 'MIT', 'https://arxiv.org/abs/2603.10910'),
  'PaddlePaddle/PaddleOCR-VL-1.6': release('PaddlePaddle/PaddleOCR-VL-1.6', 'Apache-2.0', 'https://arxiv.org/abs/2606.03264'),
  'HuggingFaceTB/SmolVLM2-2.2B-Instruct': release('HuggingFaceTB/SmolVLM2-2.2B-Instruct', 'Apache-2.0', 'https://arxiv.org/abs/2504.05299', {
    code: evidence('partial', 'The official repository contains VLM training code. The exact recipe for this 2.2B checkpoint has not been verified.', 'https://github.com/huggingface/smollm/tree/main/vision'),
    data: evidence('partial', 'The card lists public dataset sources and mixture proportions. Availability of every selected training sample has not been verified.', hf('HuggingFaceTB/SmolVLM2-2.2B-Instruct')),
  }),
  'datalab-to/chandra-ocr-2': release('datalab-to/chandra-ocr-2', 'Modified OpenRAIL-M', undefined, {
    license: evidence('no', 'The modified OpenRAIL-M terms impose commercial and competing-service restrictions, so this does not meet the open-license check.', `${hf('datalab-to/chandra-ocr-2')}/blob/main/LICENSE`, hf('datalab-to/chandra-ocr-2')),
  }),
};

for (const size of ['2B', '7B']) {
  const id = `Qwen/Qwen2-VL-${size}-Instruct`;
  modelOpenness[id] = release(id, 'Apache-2.0', 'https://arxiv.org/abs/2409.12191');
}
for (const size of ['2B', '4B']) {
  const vl = `Qwen/Qwen3-VL-${size}-Instruct`, dense = `Qwen/Qwen3.5-${size}`;
  modelOpenness[vl] = release(vl, 'Apache-2.0', 'https://arxiv.org/abs/2511.21631');
  modelOpenness[dense] = release(dense, 'Apache-2.0');
}
for (const size of ['E2B', 'E4B']) {
  const id = `google/gemma-4-${size}-it`;
  modelOpenness[id] = release(id, 'Apache-2.0', 'https://arxiv.org/abs/2607.02770');
}
const gemma3Source = 'https://ai.google.dev/gemma/docs/core/model_card_3';
modelOpenness['google/gemma-3-4b-it'] = release('google/gemma-3-4b-it', 'Gemma', 'https://arxiv.org/abs/2503.19786', {
  weights: evidence('yes', 'Weights are available after accepting the model terms.', gemma3Source),
  license: evidence('no', 'The custom Gemma terms include use restrictions; this is not an open license under these criteria.', 'https://ai.google.dev/gemma/terms'),
  card: evidence('yes', 'Google publishes a model card.', gemma3Source),
});

const easy = 'https://github.com/JaidedAI/EasyOCR';
modelOpenness['EasyOCR/Scandinavian'] = model(easy, {
  weights: evidence('yes', 'The project distributes pretrained detection and recognition checkpoints.', easy),
  license: evidence('yes', 'Apache-2.0 project license.', `${easy}/blob/master/LICENSE`),
  code: evidence('partial', 'A recognition trainer is released; the complete recipe for the shipped detection and recognition checkpoints has not been verified.', `${easy}/tree/master/trainer`),
  card: evidence('yes', 'The repository documents supported languages, model downloads and usage.', easy),
});
for (const language of ['dan', 'nor', 'swe']) {
  const source = 'https://github.com/tesseract-ocr/tessdata_best';
  modelOpenness[`Tesseract/tessdata_best-${language}`] = model(source, {
    weights: evidence('yes', 'The traineddata file is publicly downloadable.', `${source}/blob/main/${language}.traineddata`),
    license: evidence('yes', 'Apache-2.0 model repository license.', `${source}/blob/main/LICENSE`),
    code: evidence('partial', 'Tesseract training tools are public. The exact recipe for this shipped language file has not been verified.', 'https://github.com/tesseract-ocr/tesstrain'),
    data: evidence('partial', 'Language training texts are released; the langdata repository notes that some training fonts are commercial.', 'https://github.com/tesseract-ocr/langdata'),
    card: evidence('yes', 'The model repository documents the files and their use.', source),
  });
}
for (const [id, source] of [
  ['Mistral/mistral-ocr-4-1', 'https://docs.mistral.ai/models/ocr-4-1'],
  ['OpenAI/gpt-6.1-sol', 'https://developers.openai.com/api/docs/models/gpt-6.1-sol'],
]) {
  modelOpenness[id] = model(source, {
    weights: evidence('no', 'Distributed as a hosted service, without a public model-weight download.', source),
    license: evidence('no', 'API access does not provide an open license to model weights.', source),
    card: evidence('yes', 'Public model documentation describes capabilities and API usage.', source),
  });
}
