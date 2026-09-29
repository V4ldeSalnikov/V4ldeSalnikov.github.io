// Source descriptions are based on the linked dataset cards; evaluation sizes come from results.json.
export const datasetDescriptions: Record<string, { name: string; description: string; reference: string; note?: string }> = {
  'norhand': {
    name: 'NorHand',
    description: 'Norwegian letters and diaries from the 19th and early 20th centuries. The line images capture historical handwriting and spelling; the source release resizes each image to a height of 128 pixels.',
    reference: 'Transcribed text supplied with each line image.',
    note: 'TrOCR-norhand-v3 was fine-tuned on the NorHand family of datasets; its NorHand result is an in-domain comparison.',
  },
  'historical-danish': {
    name: 'Historical Danish handwriting',
    description: 'Handwritten city and parish council minutes from 1841–1939, published by Aarhus City Archives. The pages were segmented, transcribed and proofread by archive staff and volunteers.',
    reference: 'ALTO XML transcriptions. Line images are cropped from annotated boxes; page references join the annotated lines in source order.',
  },
  'modern-danish': {
    name: 'Modern Danish handwriting',
    description: 'Contemporary handwriting collected by the Danish National Archives in 2025. Volunteers copied passages from ePAROLE, mainly newspaper and magazine text from the 1990s.',
    reference: 'Proofread PAGE XML transcriptions. The line benchmark uses all 977 available lines; the page benchmark uses 100 selected pages.',
    note: 'Rectangular line crops can contain parts of neighbouring lines. This affects the line recognition task.',
  },
  'danish-typewritten': {
    name: 'Danish diplomatic reports',
    description: 'Typewritten Danish diplomatic reports, distributed as the EHRI Danish typewritten line dataset. This collection tests recognition of archival typescript rather than handwriting.',
    reference: 'Line images paired with text, with source page identifiers and crop coordinates retained in the dataset.',
  },
  'riksarkivet-ood': {
    name: 'Riksarkivet handwriting',
    description: 'Swedish archival text lines from the National Archives’ out-of-domain HTR evaluation release. The benchmark balances its sample across 19 archive and document source files.',
    reference: 'The transcription supplied with each line image in the source test split.',
  },
  'swedish-fraktur': {
    name: 'Swedish Fraktur',
    description: 'Swedish newspaper text in 19th-century blackletter type. Språkbanken produced the transcriptions, and the Swedish National Archives converted the material into line images.',
    reference: 'Transcribed text supplied with each line image, preserving historical spelling and characters.',
  },
  'oj4ocrmt-danish': {
    name: 'EU Official Journal · Danish',
    description: 'Danish pages from the 2023 Official Journal of the European Union, released in OJ4OCRMT. The benchmark uses the regular-page test subset, rendered at 300 dpi.',
    reference: 'Raw text extracted from the source PDF with pdftotext. These are digital page renderings with PDF-derived references, not manually transcribed scans.',
  },
  'oj4ocrmt-swedish': {
    name: 'EU Official Journal · Swedish',
    description: 'Swedish pages from the 2023 Official Journal of the European Union, released in OJ4OCRMT. The benchmark uses the regular-page test subset, rendered at 300 dpi.',
    reference: 'Raw text extracted from the source PDF with pdftotext. These are digital page renderings with PDF-derived references, not manually transcribed scans.',
  },
  'nasjonalt-vitenarkiv': {
    name: 'Nasjonalt vitenarkiv',
    description: 'Modern Norwegian research documents from the national research repository, including theses and reports. The benchmark selects pages across 19 configured Norwegian PDFs and renders them at 300 dpi.',
    reference: 'Text extracted directly from each PDF with PDFium. Extraction and reading order can differ from the visible page; references are not independent human transcriptions.',
  },
};
export const languageNames: Record<string, string> = { da: 'Danish', no: 'Norwegian', sv: 'Swedish' };
