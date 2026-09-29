// Versioned task membership: new datasets do not silently change these benchmarks.
const danish = [
  'line-recognition/danish-typewritten', 'line-recognition/modern-danish',
  'line-recognition/historical-danish', 'page-transcription/modern-danish',
  'page-transcription/historical-danish', 'page-transcription/oj4ocrmt-danish',
];
const norwegian = ['line-recognition/norhand', 'page-transcription/nasjonalt-vitenarkiv'];
const swedish = ['line-recognition/riksarkivet-ood', 'line-recognition/swedish-fraktur', 'page-transcription/oj4ocrmt-swedish'];

export const benchmarks = [
  { id: 'scandinavian', name: 'Scandinavian OCR', version: 'v1', languages: ['da', 'no', 'sv'],
    description: 'Archival handwriting, newspapers and modern documents in Danish, Norwegian and Swedish.',
    sampleIds: [...danish, ...norwegian, ...swedish] },
  { id: 'danish', name: 'Danish OCR', version: 'v1', languages: ['da'],
    description: 'Council minutes, contemporary handwriting, diplomatic reports and EU documents.', sampleIds: danish },
  { id: 'norwegian', name: 'Norwegian OCR', version: 'v1', languages: ['no'],
    description: 'Historical handwritten letters and diaries, alongside modern research documents.', sampleIds: norwegian },
  { id: 'swedish', name: 'Swedish OCR', version: 'v1', languages: ['sv'],
    description: 'Archival handwriting, blackletter newspapers and modern EU documents.', sampleIds: swedish },
];

export const inputName = (task: string) => task === 'line-recognition' ? 'Cropped text line' : 'Whole document page';
export const inputDescription = (task: string) => task === 'line-recognition'
  ? 'The model reads an image cropped to one line of text.'
  : 'The model reads an entire page and returns its text in reading order.';
