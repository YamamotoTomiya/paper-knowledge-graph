// Concept/Method/Representationに対する意味検索（埋め込みベースの類似度検索）。
//
// build_graph.py 本体は Qwen3-Embedding-8B（4096次元、GPU前提）を使うが、静的サイトは
// サーバーを持たないため、クエリのembedding化もブラウザ内で完結させる必要がある。
// このプロジェクトが以前実際に使っていた軽量モデル all-MiniLM-L6-v2 を
// transformers.js（WASM, ブラウザ内推論）で動かし、export_static.py が書き出した
// 同モデルのConcept/Method/Representation embedding（entity_search.bin）とコサイン類似度を取る。
//
// モデル（初回のみ ~25MB）・埋め込みデータ（~15MB）はどちらも初回の意味検索実行まで
// 取得しない（遅延ロード）。

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', MODEL_ID));
  }
  return extractorPromise;
}

let entitiesPromise = null;
// { kind, normalizedName, name, docCount, vectors: Float32Array (n*dim), dim }
function loadEntitySearchData(baseUrl) {
  if (!entitiesPromise) {
    entitiesPromise = Promise.all([
      fetch(`${baseUrl}data/entity_search_meta.json`).then((r) => r.json()),
      fetch(`${baseUrl}data/entity_search.bin`).then((r) => r.arrayBuffer()),
    ]).then(([meta, buf]) => ({
      entries: meta.entries,
      dim: meta.dim,
      model: meta.model,
      vectors: new Float32Array(buf),
    }));
  }
  return entitiesPromise;
}

export function preloadSemanticSearch(baseUrl) {
  // ユーザーが意味検索UIを開いた時点で裏でロードを始め、実際に検索を打つ頃には
  // 揃っている見込みを高める（クリックしてから初めてfetchを始めると数秒待たされる）。
  getExtractor();
  loadEntitySearchData(baseUrl);
}

export async function embedQuery(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Float32Array.from(output.data);
}

// クエリベクトルと全エンティティのコサイン類似度（どちらも正規化済みなので内積でよい）を計算し、
// threshold以上のものをスコア降順でlimit件返す。
export async function searchEntitiesBySimilarity(baseUrl, query, { threshold = 0.55, limit = 40 } = {}) {
  const [queryVec, data] = await Promise.all([embedQuery(query), loadEntitySearchData(baseUrl)]);
  const { entries, dim, vectors } = data;
  const hits = [];
  for (let i = 0; i < entries.length; i += 1) {
    let dot = 0;
    const offset = i * dim;
    for (let d = 0; d < dim; d += 1) dot += queryVec[d] * vectors[offset + d];
    if (dot >= threshold) hits.push({ ...entries[i], similarity: dot });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}
