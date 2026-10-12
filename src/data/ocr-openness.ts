import type { Checks, Evidence, Openness, Stage, Status } from '../lib/ocr-openness';

// Manually reviewed evidence, separate from the frozen evaluation results.
// Unknown means unverified, not closed. Keep checkpoint-specific evidence here.
const reviewed = '2026-10-13';
const hf = (id: string) => `https://huggingface.co/${id}`;
const evidence = (status: Status, note: string, ...sources: string[]): Evidence => ({ status, note, sources });
const unknown = (source: string, note: string) => evidence('unknown', note, source);
function stage(name: string, source: string, description: string, overrides: Partial<Checks> = {}): Stage {
  return { name, description, checks: {
    weights: unknown(source, 'An exact downloadable checkpoint for this stage has not been verified.'),
    license: unknown(source, 'A license for this stage has not been verified.'),
    code: unknown(source, 'The code and complete recipe used for this training stage have not been verified.'),
    data: unknown(source, 'A complete public training corpus or reconstruction recipe has not been verified.'),
    paper: unknown(source, 'A technical paper covering this specific stage has not been verified.'),
    card: unknown(source, 'Documentation for this specific stage has not been verified.'),
    ...overrides,
  } };
}
function release(id: string, license: string, paper?: string, overrides: Partial<Checks> = {}): Stage {
  const source = hf(id);
  return stage(id, source, 'The released checkpoint and the training that produced it from its base.', {
    weights: evidence('yes', 'Downloadable checkpoint files.', `${source}/tree/main`),
    license: evidence('yes', `${license} model license.`, source),
    card: evidence('yes', 'Public model card.', source),
    ...(paper ? { paper: evidence('yes', 'A technical report covers this model family and stage.', paper) } : {}),
    ...overrides,
  });
}
const profile = (base: Stage, post: Stage): Openness => ({ base, post, reviewed });
const undisclosed = (source: string) => stage('Base not identified', source,
  'The reviewed sources do not identify an exact starting checkpoint. No base-stage availability is assumed.');

const trocrSource = hf('microsoft/trocr-base-handwritten');
const trocr = release('microsoft/trocr-base-handwritten', 'MIT', 'https://arxiv.org/abs/2109.10282', {
  code: evidence('partial', 'TrOCR fine-tuning code is public; a complete recipe covering its upstream pretraining has not been verified.', 'https://github.com/microsoft/unilm/tree/master/trocr'),
  data: evidence('partial', 'IAM is identified for handwriting fine-tuning. The complete upstream synthetic pretraining corpus is not provided by the model card.', trocrSource, 'https://arxiv.org/abs/2109.10282'),
});
trocr.description = 'The Microsoft handwriting checkpoint, including its earlier pretraining, before Scandinavian fine-tuning.';

export const modelOpenness: Record<string, Openness> = {
  'Riksarkivet/trocr-base-handwritten-hist-swe-2': profile(trocr,
    release('Riksarkivet/trocr-base-handwritten-hist-swe-2', 'Apache-2.0', undefined, {
      data: evidence('partial', 'The card links public training datasets but explicitly states that not all training data can be released.', hf('Riksarkivet/trocr-base-handwritten-hist-swe-2')),
    })),
  'Sprakbanken/TrOCR-norhand-v3': profile(trocr,
    release('Sprakbanken/TrOCR-norhand-v3', 'CC-BY-4.0', undefined, {
      data: evidence('yes', 'The card identifies NorHand v3 as the fine-tuning data and links its public release.', hf('Sprakbanken/TrOCR-norhand-v3'), 'https://huggingface.co/datasets/Teklia/NorHand-v3-line'),
    })),
  'stepfun-ai/GOT-OCR-2.0-hf': profile(undisclosed(hf('stepfun-ai/GOT-OCR-2.0-hf')),
    release('stepfun-ai/GOT-OCR-2.0-hf', 'Apache-2.0', 'https://arxiv.org/abs/2409.01704', {
      code: evidence('partial', 'The authors release stage 2/3 post-training code on top of GOT weights. This does not establish a complete recipe for the evaluated checkpoint.', 'https://github.com/Ucas-HaoranWei/GOT-OCR2.0'),
    })),
  'zai-org/GLM-OCR': profile(undisclosed(hf('zai-org/GLM-OCR')),
    release('zai-org/GLM-OCR', 'MIT', 'https://arxiv.org/abs/2603.10910')),
  'PaddlePaddle/PaddleOCR-VL-1.6': profile(
    release('PaddlePaddle/PaddleOCR-VL-1.5', 'Apache-2.0', 'https://arxiv.org/abs/2601.21957'),
    release('PaddlePaddle/PaddleOCR-VL-1.6', 'Apache-2.0', 'https://arxiv.org/abs/2606.03264')),
  'HuggingFaceTB/SmolVLM2-2.2B-Instruct': profile(
    release('HuggingFaceTB/SmolVLM-Instruct', 'Apache-2.0', 'https://arxiv.org/abs/2504.05299', {
      code: evidence('partial', 'SmolVLM training code is public. A complete recipe covering all upstream language and vision pretraining has not been verified.', 'https://github.com/huggingface/smollm/tree/main/vision'),
      data: evidence('partial', 'SmolVLM links public training datasets, but its SigLIP encoder was pretrained on WebLI; a complete public upstream corpus has not been verified.', hf('HuggingFaceTB/SmolVLM-Instruct'), hf('google/siglip-so400m-patch14-384')),
    }),
    release('HuggingFaceTB/SmolVLM2-2.2B-Instruct', 'Apache-2.0', 'https://arxiv.org/abs/2504.05299', {
      code: evidence('partial', 'The official repository contains VLM pretraining and fine-tuning code. The exact recipe for this 2.2B checkpoint has not been verified.', 'https://github.com/huggingface/smollm/tree/main/vision'),
      data: evidence('partial', 'The card lists public dataset sources and mixture proportions. Availability of every selected training sample has not been verified.', hf('HuggingFaceTB/SmolVLM2-2.2B-Instruct')),
    })),
  'datalab-to/chandra-ocr-2': profile(undisclosed(hf('datalab-to/chandra-ocr-2')),
    release('datalab-to/chandra-ocr-2', 'Modified OpenRAIL-M', undefined, {
      license: evidence('no', 'The modified OpenRAIL-M terms impose commercial and competing-service restrictions, so this does not meet the open-license check.', `${hf('datalab-to/chandra-ocr-2')}/blob/main/LICENSE`, hf('datalab-to/chandra-ocr-2')),
    })),
};

for (const size of ['2B', '7B']) {
  const id = `Qwen/Qwen2-VL-${size}-Instruct`;
  modelOpenness[id] = profile(release(`Qwen/Qwen2-VL-${size}`, 'Apache-2.0', 'https://arxiv.org/abs/2409.12191'),
    release(id, 'Apache-2.0', 'https://arxiv.org/abs/2409.12191'));
}
for (const size of ['2B', '4B']) {
  const vl = `Qwen/Qwen3-VL-${size}-Instruct`, dense = `Qwen/Qwen3.5-${size}`;
  modelOpenness[vl] = profile(stage('Qwen3-VL pretraining', 'https://github.com/QwenLM/Qwen3-VL',
    'The report describes pretraining; the exact pretrained multimodal checkpoint has not been verified separately from the instruction-tuned release.', {
      paper: evidence('yes', 'The Qwen3-VL report describes pretraining.', 'https://arxiv.org/abs/2511.21631'),
      card: evidence('yes', 'The official repository documents the model family and architecture.', 'https://github.com/QwenLM/Qwen3-VL'),
    }), release(vl, 'Apache-2.0', 'https://arxiv.org/abs/2511.21631'));
  modelOpenness[dense] = profile(release(`${dense}-Base`, 'Apache-2.0'), release(dense, 'Apache-2.0'));
}
for (const size of ['E2B', 'E4B']) {
  const base = `google/gemma-4-${size}`;
  modelOpenness[`${base}-it`] = profile(release(base, 'Apache-2.0', 'https://arxiv.org/abs/2607.02770'),
    release(`${base}-it`, 'Apache-2.0', 'https://arxiv.org/abs/2607.02770'));
}
const gemma3Source = 'https://ai.google.dev/gemma/docs/core/model_card_3';
const gemma3Checks: Partial<Checks> = {
  weights: evidence('yes', 'Pretrained and instruction-tuned weights are available after accepting the model terms.', gemma3Source),
  license: evidence('no', 'The custom Gemma terms include use restrictions; this is not an open license under these criteria.', 'https://ai.google.dev/gemma/terms'),
  card: evidence('yes', 'Google publishes a model card covering pretrained and instruction-tuned variants.', gemma3Source),
};
modelOpenness['google/gemma-3-4b-it'] = profile(
  release('google/gemma-3-4b-pt', 'Gemma', 'https://arxiv.org/abs/2503.19786', gemma3Checks),
  release('google/gemma-3-4b-it', 'Gemma', 'https://arxiv.org/abs/2503.19786', gemma3Checks));

const easy = 'https://github.com/JaidedAI/EasyOCR';
modelOpenness['EasyOCR/Scandinavian'] = profile(stage('Detection and recognition backbones', easy,
  'EasyOCR combines a pretrained CRAFT detector and a recognizer. A complete checkpoint-level training lineage has not been verified.'),
  stage('EasyOCR Scandinavian configuration', easy, 'The released detection and Latin-script recognition models used for Scandinavian OCR.', {
    weights: evidence('yes', 'The project distributes pretrained detection and recognition checkpoints.', easy),
    license: evidence('yes', 'Apache-2.0 project license.', `${easy}/blob/master/LICENSE`),
    code: evidence('partial', 'A recognition trainer is released; the complete recipe for the shipped detection and recognition checkpoints has not been verified.', `${easy}/tree/master/trainer`),
    card: evidence('yes', 'The repository documents supported languages, model downloads and usage.', easy),
  }));
for (const language of ['dan', 'nor', 'swe']) {
  const source = 'https://github.com/tesseract-ocr/tessdata_best';
  modelOpenness[`Tesseract/tessdata_best-${language}`] = profile(stage('Tesseract training lineage', source,
    'The language-file documentation does not distinguish an exact base checkpoint from later language training.'),
    stage(`tessdata_best/${language}`, source, 'The released language model. A distinct post-training phase has not been established.', {
      weights: evidence('yes', 'The traineddata file is publicly downloadable.', `${source}/blob/main/${language}.traineddata`),
      license: evidence('yes', 'Apache-2.0 model repository license.', `${source}/blob/main/LICENSE`),
      code: evidence('partial', 'Tesseract training tools are public. The exact recipe for this shipped language file has not been verified.', 'https://github.com/tesseract-ocr/tesstrain'),
      data: evidence('partial', 'Language training texts are released; the langdata repository notes that some training fonts are commercial.', 'https://github.com/tesseract-ocr/langdata'),
      card: evidence('yes', 'The model repository documents the files and their use.', source),
    }));
}
for (const [id, source] of [
  ['Mistral/mistral-ocr-4-1', 'https://docs.mistral.ai/models/ocr-4-1'],
  ['OpenAI/gpt-6.1-sol', 'https://developers.openai.com/api/docs/models/gpt-6.1-sol'],
]) {
  modelOpenness[id] = profile(undisclosed(source), stage(id, source, 'The evaluated hosted API model; its internal training stages are not disclosed in the model documentation.', {
    weights: evidence('no', 'Distributed as a hosted service, without a public model-weight download.', source),
    license: evidence('no', 'API access does not provide an open license to model weights.', source),
    card: evidence('yes', 'Public model documentation describes capabilities and API usage.', source),
  }));
}
