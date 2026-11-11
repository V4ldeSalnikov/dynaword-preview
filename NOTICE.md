# Website and data licensing

The explorer's source code is released under the [MIT licence](LICENSE).
This licence does not relicense the underlying corpora, model weights, derived
vectors or third-party dependencies. Original texts retain the licences of their
individual source collections. Dataset and source cards linked in the comparison
view document provenance and applicable terms.

Danish fastText word vectors and their derived document vectors retain CC BY-SA
3.0 attribution and share-alike terms; see the root README. The website's published
comparison figures are derived from the pinned Dynaword dataset metadata, with
provenance recorded in `web/public/data/corpora.json`.

Additional-language semantic indexes use the MIT-licensed
[minishlab/potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M)
model through Model2Vec. The pinned model repository retains its license and
attribution. Original text and annotation licenses remain source-specific; an
embedding model license does not relicense the corpus.

The optional browser assistant downloads [LiquidAI/LFM2.5-1.2B-Instruct-ONNX](https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX), under Liquid AI's LFM 1.0 licence. The weights are fetched directly from the pinned model repository and are not included in this repository. Transformers.js is Apache-2.0 licensed; dependencies retain their own licences.
