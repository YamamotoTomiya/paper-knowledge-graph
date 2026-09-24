// 論文タイトル/abstractおよびConcept/Method/Representationに対する意味検索（埋め込みベースの類似度検索）。
//
// build_graph.py 本体は Qwen3-Embedding-8B（4096次元、GPU前提）を使うが、静的サイトは
// サーバーを持たないため、クエリのembedding化もブラウザ内で完結させる必要がある。
// このプロジェクトが以前実際に使っていた軽量モデル all-MiniLM-L6-v2 を
// transformers.js（WASM, ブラウザ内推論）で動かし、export_static.py が書き出した
// 同モデルのembedding（entity_search.bin, paper_search.bin）とコサイン類似度を取る。
//
// モデル（初回のみ ~25MB）・埋め込みデータはどちらも初回の意味検索実行まで取得しない（遅延ロード）。
import { PAPERS, neighborsOf } from './graph.js';

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

let papersPromise = null;
// { urls: string[], dim, vectors: Float32Array (n*dim) } — 全論文のタイトル+abstract embedding
function loadPaperSearchData(baseUrl) {
  if (!papersPromise) {
    papersPromise = Promise.all([
      fetch(`${baseUrl}data/paper_search_meta.json`).then((r) => r.json()),
      fetch(`${baseUrl}data/paper_search.bin`).then((r) => r.arrayBuffer()),
    ]).then(([meta, buf]) => ({
      urls: meta.urls,
      dim: meta.dim,
      vectors: new Float32Array(buf),
    }));
  }
  return papersPromise;
}

export function preloadSemanticSearch(baseUrl) {
  // ユーザーが意味検索UIを開いた時点で裏でロードを始め、実際に検索を打つ頃には
  // 揃っている見込みを高める（クリックしてから初めてfetchを始めると数秒待たされる）。
  getExtractor();
  loadEntitySearchData(baseUrl);
  loadPaperSearchData(baseUrl);
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

// クエリと論文タイトル+abstractのembeddingを直接比較する意味検索
// （Concept/Method/Representation経由の間接一致とは別に、論文本文そのものに近いかを見る）。
export async function searchPapersBySimilarity(baseUrl, query, { threshold = 0.4, limit = 40 } = {}) {
  const [queryVec, data] = await Promise.all([embedQuery(query), loadPaperSearchData(baseUrl)]);
  const { urls, dim, vectors } = data;
  const hits = [];
  for (let i = 0; i < urls.length; i += 1) {
    let dot = 0;
    const offset = i * dim;
    for (let d = 0; d < dim; d += 1) dot += queryVec[d] * vectors[offset + d];
    if (dot >= threshold) hits.push({ url: urls[i], similarity: dot });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, limit);
}

// 意味検索: (1) クエリに近いConcept/Method/Representationを探し、それらと繋がる論文
// （graph_app.py の「意味的に近いConcept/Method/Representationも含める」検索と同じ考え方）と、
// (2) クエリに近い論文タイトル・abstractそのもの、の両方を検索して類似度で1本にまとめる。
// SearchSidebar（関係グラフ）・GlobalMap（全体マップ）の両方から使う共通ロジック。
export async function semanticSearchPapers(baseUrl, query, { threshold, limit }) {
  const [entityHits, paperHits] = await Promise.all([
    searchEntitiesBySimilarity(baseUrl, query, { threshold, limit: 40 }),
    searchPapersBySimilarity(baseUrl, query, { threshold, limit: 60 }),
  ]);
  const bestByPaper = new Map(); // url -> { similarity, source, entityName?, entityKind? }
  for (const hit of entityHits) {
    const neighbors = neighborsOf({ kind: hit.kind, key: hit.normalized_name });
    for (const { other } of neighbors) {
      if (other.kind !== 'paper') continue;
      const prev = bestByPaper.get(other.key);
      if (!prev || hit.similarity > prev.similarity) {
        bestByPaper.set(other.key, { similarity: hit.similarity, source: 'entity', entityName: hit.name, entityKind: hit.kind });
      }
    }
  }
  for (const hit of paperHits) {
    const prev = bestByPaper.get(hit.url);
    if (!prev || hit.similarity > prev.similarity) {
      bestByPaper.set(hit.url, { similarity: hit.similarity, source: 'paper' });
    }
  }
  const rows = [...bestByPaper.entries()]
    .map(([url, match]) => ({ url, paper: PAPERS[url], match }))
    .filter((r) => r.paper)
    .sort((a, b) => b.match.similarity - a.match.similarity || b.paper.score - a.paper.score);
  return { rows: rows.slice(0, limit), entityHitCount: entityHits.length, paperHitCount: paperHits.length };
}
