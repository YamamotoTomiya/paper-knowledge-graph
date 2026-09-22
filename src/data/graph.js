// papers.json / graph.json の読み込みとインデックス構築（モジュールロード時に一度だけ実行）。
// データはビルドにバンドルせず public/data から実行時 fetch する
// （JP_Market_Vis の M4/M5 パターン踏襲。papers.jsonだけで数MB〜十数MB規模のため）。
import { loadDataset } from './loadDataset.js';
import { createEntitySearcher, createPaperSearcher } from './search.js';

const [papersData, graphData] = await loadDataset(import.meta.env?.BASE_URL ?? '/');

export const PAPERS = papersData.papers; // url -> paper fields
export const CATEGORIES = papersData.categories; // name -> label
export const TOPICS = graphData.topics; // id -> {label, top_terms, size}
export const CONCEPTS = graphData.concepts; // normalized_name -> {name, aliases}
export const METHODS = graphData.methods;
export const REPRESENTATIONS = graphData.representations;
export const RELATIONS = graphData.relations;
export const META = {
  generatedAt: graphData.generated_at,
  datasetId: graphData.dataset_id,
};

export const ENTITY_LABELS = { concept: 'コンセプト', method: '手法', representation: '表現形式' };
export const ENTITIES_BY_KIND = { concept: CONCEPTS, method: METHODS, representation: REPRESENTATIONS };

export const RELATION_TYPE_JA = {
  SIMILAR_TO: '類似論文',
  DISCUSSES: 'コンセプト',
  USES_METHOD: '手法',
  USES_REPRESENTATION: '表現形式',
};

export const CATEGORY_COLORS = {
  ai4mat: '#6f95bd',
  mat_sci: '#c4906f',
  ai4sci: '#7fa98b',
  info_sci: '#b58aa5',
  onco_mirna: '#9a8dc0',
  quantum_comp: '#c2a35a',
  uncategorized: '#94a3b8',
};
export const CATEGORY_TEXT_COLORS = {
  ai4mat: '#0369a1',
  mat_sci: '#9a3412',
  ai4sci: '#166534',
  info_sci: '#be185d',
  onco_mirna: '#6d28d9',
  quantum_comp: '#a16207',
  uncategorized: '#475569',
};

export const nodeKey = (ref) => `${ref.kind}:${ref.key}`;

export function nodeInfo(ref) {
  if (ref.kind === 'paper') return PAPERS[ref.key] ?? null;
  return ENTITIES_BY_KIND[ref.kind]?.[ref.key] ?? null;
}

export function nodeName(ref) {
  if (ref.kind === 'paper') return PAPERS[ref.key]?.title ?? ref.key;
  return ENTITIES_BY_KIND[ref.kind]?.[ref.key]?.name ?? ref.key;
}

// 隣接インデックス: nodeKey → [{relation, other}]
const adjacency = new Map();
for (const rel of RELATIONS) {
  const sKey = nodeKey(rel.source);
  const tKey = nodeKey(rel.target);
  if (!adjacency.has(sKey)) adjacency.set(sKey, []);
  if (!adjacency.has(tKey)) adjacency.set(tKey, []);
  adjacency.get(sKey).push({ relation: rel, other: rel.target, isOutgoing: true });
  adjacency.get(tKey).push({ relation: rel, other: rel.source, isOutgoing: false });
}
export function neighborsOf(ref) {
  return adjacency.get(nodeKey(ref)) ?? [];
}
export function degreeOf(ref) {
  return neighborsOf(ref).length;
}

// トピックごとの論文一覧・カテゴリごとの論文一覧（一覧・フィルタ用）
export const PAPERS_BY_TOPIC = new Map();
export const PAPERS_BY_CATEGORY = new Map();
export const PAPER_ENTRIES = Object.entries(PAPERS).map(([url, p]) => ({ url, ...p }));
for (const p of PAPER_ENTRIES) {
  if (p.topic_id) {
    if (!PAPERS_BY_TOPIC.has(p.topic_id)) PAPERS_BY_TOPIC.set(p.topic_id, []);
    PAPERS_BY_TOPIC.get(p.topic_id).push(p.url);
  }
  const cat = p.category || 'uncategorized';
  if (!PAPERS_BY_CATEGORY.has(cat)) PAPERS_BY_CATEGORY.set(cat, []);
  PAPERS_BY_CATEGORY.get(cat).push(p.url);
}

// カテゴリ→トピックの集計グラフ（全体マップ用）。トピックの「主カテゴリ」は所属論文最多のカテゴリ。
export const CATEGORY_TOPIC_GRAPH = (() => {
  const pairCount = new Map(); // "cat|topic" -> count
  const topicCatCount = new Map(); // topic -> Map(cat->count)
  for (const p of PAPER_ENTRIES) {
    if (!p.topic_id) continue;
    const cat = p.category || 'uncategorized';
    const key = `${cat}|${p.topic_id}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    if (!topicCatCount.has(p.topic_id)) topicCatCount.set(p.topic_id, new Map());
    const m = topicCatCount.get(p.topic_id);
    m.set(cat, (m.get(cat) ?? 0) + 1);
  }
  const topicDominantCat = new Map();
  for (const [topicId, m] of topicCatCount) {
    let best = null, bestN = -1;
    for (const [cat, n] of m) if (n > bestN) { best = cat; bestN = n; }
    topicDominantCat.set(topicId, best);
  }
  const nodes = [];
  for (const [name, label] of Object.entries(CATEGORIES)) {
    const total = PAPERS_BY_CATEGORY.get(name)?.length ?? 0;
    if (total === 0) continue;
    nodes.push({ id: `category:${name}`, kind: 'category', key: name, name: label, size: total });
  }
  for (const [topicId, info] of Object.entries(TOPICS)) {
    const total = PAPERS_BY_TOPIC.get(topicId)?.length ?? 0;
    if (total === 0) continue;
    nodes.push({
      id: `topic:${topicId}`, kind: 'topic', key: topicId, name: info.label, size: total,
      dominantCategory: topicDominantCat.get(topicId) ?? 'uncategorized',
    });
  }
  const links = [];
  for (const [key, count] of pairCount) {
    const [cat, topicId] = key.split('|');
    links.push({ source: `category:${cat}`, target: `topic:${topicId}`, count });
  }
  return { nodes, links };
})();

export const STATS = (() => {
  const byCategory = {};
  const byTopic = {};
  let totalScore = 0;
  for (const p of PAPER_ENTRIES) {
    const cat = p.category || 'uncategorized';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (p.topic_id) byTopic[p.topic_id] = (byTopic[p.topic_id] ?? 0) + 1;
    totalScore += p.score || 0;
  }
  return {
    papers: PAPER_ENTRIES.length,
    topics: Object.keys(TOPICS).length,
    concepts: Object.keys(CONCEPTS).length,
    methods: Object.keys(METHODS).length,
    representations: Object.keys(REPRESENTATIONS).length,
    relations: RELATIONS.length,
    avgScore: PAPER_ENTRIES.length ? totalScore / PAPER_ENTRIES.length : 0,
    byCategory,
    byTopic,
  };
})();

export const searchPapers = createPaperSearcher(PAPERS);
export const searchConcepts = createEntitySearcher(CONCEPTS);
export const searchMethods = createEntitySearcher(METHODS);
export const searchRepresentations = createEntitySearcher(REPRESENTATIONS);
