# Example attribution

These are selected inputs and saved predictions from ScandiOCR Eval, not new model runs.
Each task/dataset contributes three cases, chosen by sorting the SHA-256 digest of
`scandiocr-examples-v1:` plus the case identifier. Selection does not use model scores.
The public gallery contains 33 examples and 600 predictions from nine datasets.

Images are byte-identical to the frozen benchmark PNGs. Inputs may already be line
crops or PDF renderings made by the evaluation adapter. References and predictions
are copied without rewriting. The highlighted view normalizes Unicode and whitespace
for a visual word comparison; turn highlighting off to read the saved text verbatim.

| Dataset | Attribution | Reuse terms / source |
| --- | --- | --- |
| NorHand v2 | TEKLIA and the Hugin-Munin project; source contributors | [Dataset card (MIT)](https://huggingface.co/datasets/Teklia/NorHand-v2-line), [original release](https://zenodo.org/records/10555698), [MIT license text](licenses/MIT.txt) |
| Historical Danish handwriting | Aarhus City Archives and contributing archives | [Dataset](https://huggingface.co/datasets/aarhus-city-archives/historical-danish-handwriting), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Modern Danish handwriting | Danish National Archives | [Dataset](https://huggingface.co/datasets/RA-Data-Science/modern-danish-handwriting), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Danish diplomatic reports | EHRI dataset contributors; originals held by the Danish National Archives; line dataset by V4ldeLund | [Dataset and license](https://huggingface.co/datasets/V4ldeLund/ehri-danish-typewritten-lines/blob/main/LICENSE.md), [original EHRI dataset](https://github.com/FloChiff/ehri-dataset), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Swedish Fraktur | Språkbanken and the Swedish National Archives | [Dataset card (Apache 2.0 metadata)](https://huggingface.co/datasets/Riksarkivet/swedish_fraktur), [license text](licenses/Apache-2.0.txt) |
| Riksarkivet out-of-domain handwriting | Swedish National Archives | [Source dataset](https://huggingface.co/datasets/Riksarkivet/eval_htr_out_of_domain_lines). The source release does not state a license. |
| OJ4OCRMT Danish and Swedish | Paul McNamee, Kevin Duh, Cameron Carpenter, Ron Colaianni, Nolan King and Kenton Murray; JHU HLTCOE; European Union source documents | [Dataset](https://huggingface.co/datasets/hltcoe/OJ4OCRMT), [publication](https://aclanthology.org/2025.mtsummit-1.9/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Nasjonalt vitenarkiv | Original publication authors; dataset by Danish Foundation Models | [Dataset](https://huggingface.co/datasets/danish-foundation-models/nasjonalt-vitenarkiv). Only documents recorded as [CC0](https://creativecommons.org/publicdomain/zero/1.0/) are included; individual publication links accompany each example. |

Source license metadata checked on 29 September 2026. Source revisions and image hashes
are retained in each example JSON. These terms apply to the source material; they do
not imply endorsement by the original authors or institutions.
