import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  CATEGORIES, CATEGORY_TEXT_COLORS, ENTITY_COLOR, ENTITY_LABELS, PAPERS, PAPER_GLOBAL_GRAPH, TOPICS,
  TOPIC_COLORS, neighborsOf, nodeKey, nodeName, searchPapers,
} from '../data/graph.js';
import { preloadSemanticSearch, semanticSearchPapers } from '../data/semanticSearch.js';
import { drawHoverLabel } from '../flow/canvasLabel.js';

const BASE_URL = import.meta.env?.BASE_URL ?? '/';

// JP_Market_Vis の全体マップ（白い円+業種色の縁、円の大きさ=関係数）を踏襲。
// ノード=論文（SIMILAR_TOを持つものだけ）、縁の色=カテゴリ、大きさ=SIMILAR_TO本数(degree)。
const nodeRadius = (degree) => Math.max(2.5, Math.min(22, Math.sqrt(degree) * 4));
const AVAILABLE_CATEGORIES = Object.keys(CATEGORIES);
const DEFAULT_MAX_NODES = 1500;
const DEFAULT_ENTITY_BUDGET = 250;
const SEARCH_HIT_LIMIT = 25;
const SEARCH_CONTEXT_PER_HIT = 5;
const SEARCH_ENTITIES_PER_HIT = 6;
const LIST_PAGE_SIZE = 50;
const TOPIC_LIST = Object.entries(TOPICS)
  .map(([id, t]) => ({ id, ...t }))
  .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// 表示中の論文集合に対して、それらが扱うConcept/Method/Representationのうち
// 表示中の論文との接続数が多いもの（=いま見えている範囲でのハブ的な概念）を
// 一定数だけ選んで加える。論文数がいくら多くても際限なく増えないよう上限で絞る。
function addEntityContext(paperNodes, budget) {
  const entityCount = new Map(); // id -> 接続数
  const entityInfo = new Map(); // id -> {kind, title}
  for (const p of paperNodes) {
    for (const nb of neighborsOf({ kind: 'paper', key: p.id })) {
      if (nb.other.kind === 'paper') continue;
      const id = nodeKey(nb.other);
      entityCount.set(id, (entityCount.get(id) ?? 0) + 1);
      if (!entityInfo.has(id)) entityInfo.set(id, { kind: nb.other.kind, title: nodeName(nb.other), ref: nb.other });
    }
  }
  const topIds = new Set(
    [...entityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, budget).map(([id]) => id),
  );
  const entityNodes = [...topIds].map((id) => ({
    id, kind: entityInfo.get(id).kind, title: entityInfo.get(id).title, ref: entityInfo.get(id).ref, degree: entityCount.get(id),
  }));
  const entityLinks = [];
  for (const p of paperNodes) {
    for (const nb of neighborsOf({ kind: 'paper', key: p.id })) {
      if (nb.other.kind === 'paper' || !topIds.has(nodeKey(nb.other))) continue;
      entityLinks.push({ source: p.id, target: nodeKey(nb.other), kind: 'entity', entityKind: nb.other.kind });
    }
  }
  return { entityNodes, entityLinks };
}

function filterGraph(activeCategories, minDegree, maxNodes, showEntities, topicFilter) {
  let paperNodes = PAPER_GLOBAL_GRAPH.nodes.filter(
    (n) => activeCategories.has(n.category) && n.degree >= minDegree
      && (!topicFilter || n.topicId === topicFilter),
  );
  const totalMatching = paperNodes.length;
  paperNodes = [...paperNodes].sort((a, b) => b.degree - a.degree).slice(0, maxNodes);
  const ids = new Set(paperNodes.map((n) => n.id));
  const similarLinks = PAPER_GLOBAL_GRAPH.links
    .filter((l) => ids.has(l.source.id ?? l.source) && ids.has(l.target.id ?? l.target))
    .map((l) => ({ source: l.source.id ?? l.source, target: l.target.id ?? l.target, kind: 'similar' }));

  if (!showEntities) {
    return { nodes: paperNodes, links: similarLinks, truncated: Math.max(0, totalMatching - paperNodes.length) };
  }
  const { entityNodes, entityLinks } = addEntityContext(paperNodes, DEFAULT_ENTITY_BUDGET);
  return {
    nodes: [...paperNodes, ...entityNodes],
    links: [...similarLinks, ...entityLinks],
    truncated: Math.max(0, totalMatching - paperNodes.length),
  };
}

// 一致した論文（urls, 関連度順）＋その類似論文（文脈）＋一致論文が扱うConcept/Method/
// Representationで構成する部分グラフを作る。一致論文だけだと互いに孤立した点の羅列に
// なりがちなので、SIMILAR_TOで繋がる周辺論文と、論文が実際に何を扱っているか
// （コンセプト等）を合わせて見せることで「関連する論文のナレッジグラフ」として見えるように
// する。キーワード検索（部分一致）・意味検索（埋め込み類似度）のどちらの結果も同じ形で使える。
function buildSearchGraphFromUrls(urls, maxNodes) {
  const nodeMap = new Map(); // id (url or "kind:name") -> node
  const addPaper = (url, matched) => {
    const p = PAPERS[url];
    if (!p) return;
    const existing = nodeMap.get(url);
    if (existing) { existing.matched = existing.matched || matched; return; }
    const degree = neighborsOf({ kind: 'paper', key: url }).filter((n) => n.other.kind === 'paper').length;
    nodeMap.set(url, { id: url, kind: 'paper', title: p.title, category: p.category || 'uncategorized', topicId: p.topic_id ?? null, score: p.score, degree, matched });
  };
  for (const url of urls) addPaper(url, true);
  for (const url of urls) {
    const nbs = neighborsOf({ kind: 'paper', key: url })
      .filter((n) => n.other.kind === 'paper')
      .sort((a, b) => (b.relation.score ?? 0) - (a.relation.score ?? 0))
      .slice(0, SEARCH_CONTEXT_PER_HIT);
    for (const nb of nbs) addPaper(nb.other.key, false);
  }

  // 一致論文が扱うConcept/Method/Representationも加える（graph_app.py の検索結果グラフに
  // Concept/Method/Representationノードを含めていたのと同じ考え方）
  const entityLinks = []; // {source: paperUrl, target: entityId}
  for (const url of urls) {
    const entityNbs = neighborsOf({ kind: 'paper', key: url })
      .filter((n) => n.other.kind !== 'paper')
      .slice(0, SEARCH_ENTITIES_PER_HIT);
    for (const nb of entityNbs) {
      const id = nodeKey(nb.other);
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, kind: nb.other.kind, title: nodeName(nb.other), ref: nb.other, degree: 1, matched: true });
      } else {
        nodeMap.get(id).degree += 1;
      }
      entityLinks.push({ source: url, target: id, entityKind: nb.other.kind });
    }
  }

  let nodes = [...nodeMap.values()];
  const totalMatching = nodes.length;
  if (nodes.length > maxNodes) {
    // 論文（一致→文脈の順）を優先して残し、Concept/Method/Representationは次点で間引く
    const rank = (n) => (n.kind !== 'paper' ? 2 : n.matched ? 0 : 1);
    nodes.sort((a, b) => rank(a) - rank(b) || (b.degree - a.degree));
    nodes = nodes.slice(0, maxNodes);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const similarLinks = PAPER_GLOBAL_GRAPH.links.filter(
    (l) => ids.has(l.source.id ?? l.source) && ids.has(l.target.id ?? l.target),
  );
  const links = [
    ...similarLinks.map((l) => ({ source: l.source.id ?? l.source, target: l.target.id ?? l.target, kind: 'similar' })),
    ...entityLinks.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l, kind: 'entity' })),
  ];
  return { nodes, links, truncated: Math.max(0, totalMatching - nodes.length), hitCount: urls.length };
}

function buildSearchGraph(query, maxNodes) {
  return buildSearchGraphFromUrls(searchPapers(query, SEARCH_HIT_LIMIT).map((h) => h.url), maxNodes);
}

export default function GlobalMap({ onOpenPaper }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const hoverRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverNode, setHoverNode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const lastClickRef = useRef({ id: null, time: 0 });
  const [activeCategories, setActiveCategories] = useState(new Set(AVAILABLE_CATEGORIES));
  const [minDegree, setMinDegree] = useState(1);
  const [maxNodes, setMaxNodes] = useState(DEFAULT_MAX_NODES);
  const [showEntities, setShowEntities] = useState(true);
  const [showList, setShowList] = useState(true);
  const [listPage, setListPage] = useState(0);
  const [listKindFilter, setListKindFilter] = useState('paper'); // 'paper' | 'concept' | 'method' | 'representation'
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState('');
  const [colorByTopic, setColorByTopic] = useState(false);
  const [searchMode, setSearchMode] = useState('text'); // 'text' | 'semantic'
  const [semanticThreshold, setSemanticThreshold] = useState(0.55);
  const [semanticLimit, setSemanticLimit] = useState(SEARCH_HIT_LIMIT);
  const [semanticState, setSemanticState] = useState({ status: 'idle', rows: [], entityHitCount: 0, paperHitCount: 0 });
  // グラフの再構築は毎回の入力・スライダー操作のたびに行わず、操作が止まってから行う。
  // 毎回作り直すとForceGraph2Dが完全新規データとして扱い、ノード位置がリセットされて
  // 画面がちらつく（エッジが点滅して見える）ため（検索ボックス・スライダー共通の対策）。
  const debouncedQuery = useDebouncedValue(query, 350);
  const debouncedActiveCategories = useDebouncedValue(activeCategories, 300);
  const debouncedMinDegree = useDebouncedValue(minDegree, 300);
  const debouncedMaxNodes = useDebouncedValue(maxNodes, 300);
  const debouncedTopicFilter = useDebouncedValue(topicFilter, 300);
  const isTextSearching = searchMode === 'text' && debouncedQuery.trim().length > 0;
  const isSemanticSearching = searchMode === 'semantic' && semanticState.status === 'done' && semanticState.rows.length > 0;
  const isSearching = isTextSearching || isSemanticSearching;
  const results = useMemo(() => (isTextSearching ? searchPapers(debouncedQuery, 12) : []), [isTextSearching, debouncedQuery]);

  const switchSearchMode = useCallback((next) => {
    setSearchMode(next);
    if (next === 'semantic') preloadSemanticSearch(BASE_URL);
  }, []);

  const runSemanticSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSemanticState((s) => ({ ...s, status: 'loading' }));
    try {
      const { rows, entityHitCount, paperHitCount } = await semanticSearchPapers(
        BASE_URL, query, { threshold: semanticThreshold, limit: semanticLimit },
      );
      setSemanticState({ status: 'done', rows, entityHitCount, paperHitCount });
    } catch (err) {
      setSemanticState({ status: 'error', rows: [], entityHitCount: 0, paperHitCount: 0, message: err.message });
    }
  }, [query, semanticThreshold, semanticLimit]);

  useEffect(() => {
    const el = wrapRef.current;
    const resize = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    if (isTextSearching) return buildSearchGraph(debouncedQuery, debouncedMaxNodes);
    if (isSemanticSearching) return buildSearchGraphFromUrls(semanticState.rows.map((r) => r.url), debouncedMaxNodes);
    return filterGraph(debouncedActiveCategories, debouncedMinDegree, debouncedMaxNodes, showEntities, debouncedTopicFilter);
  }, [
    isTextSearching, isSemanticSearching, debouncedQuery, semanticState.rows,
    debouncedActiveCategories, debouncedMinDegree, debouncedMaxNodes, showEntities, debouncedTopicFilter,
  ]);

  // 選択中ノードに直接つながるノードだけの集合（他を減光するため）。データが変わったら選択解除。
  useEffect(() => { setSelectedId(null); setListPage(0); }, [data]);
  useEffect(() => { setListPage(0); }, [listKindFilter]);

  // いま地図上に表示されているノードの種別ごとの件数（一覧パネルのタブに使う）。
  const listKindCounts = useMemo(() => {
    const counts = { paper: 0, concept: 0, method: 0, representation: 0 };
    for (const n of data.nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    return counts;
  }, [data]);

  // いま地図上に表示されているノードのうち、選択中の種別（論文/コンセプト/手法/表現形式）
  // だけの一覧（右パネル用）。検索中は一致優先→スコア順、通常時は接続数（degree、
  // 論文なら類似論文数、Concept等なら扱う論文数。＝円や四角の大きさの順）で並べる。
  const nodeList = useMemo(() => {
    const items = data.nodes.filter((n) => n.kind === listKindFilter);
    return items.sort((a, b) => (
      isSearching ? (b.matched - a.matched) || ((b.score ?? 0) - (a.score ?? 0)) : b.degree - a.degree
    ));
  }, [data, isSearching, listKindFilter]);
  const listPageCount = Math.max(1, Math.ceil(nodeList.length / LIST_PAGE_SIZE));
  const listPageItems = nodeList.slice(listPage * LIST_PAGE_SIZE, (listPage + 1) * LIST_PAGE_SIZE);
  const connectedIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set([selectedId]);
    for (const l of data.links) {
      const s = l.source.id ?? l.source;
      const t = l.target.id ?? l.target;
      if (s === selectedId) set.add(t);
      else if (t === selectedId) set.add(s);
    }
    return set;
  }, [selectedId, data]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force('charge')?.strength(-30);
    fg.d3Force('link')?.distance(24).strength(0.4);
  }, [data]);

  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(400, 30);
  }, []);

  const toggleCategory = (key) => setActiveCategories((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const nodeGeometry = useCallback((node, hover) => {
    if (node.kind !== 'paper') {
      const s = (hover ? 9 : 6.5) * 2; // 正方形の一辺
      return { isEntity: true, s, color: ENTITY_COLOR[node.kind] ?? '#94a3b8' };
    }
    const r = nodeRadius(node.degree) * (hover ? 1.4 : 1) * (isSearching && node.matched ? 1.3 : 1);
    const color = colorByTopic
      ? (TOPIC_COLORS[node.topicId] ?? '#94a3b8')
      : (CATEGORY_TEXT_COLORS[node.category] ?? '#94a3b8');
    return { isEntity: false, r, color };
  }, [isSearching, colorByTopic]);

  const drawNode = useCallback((node, ctx, scale) => {
    const hover = node === hoverRef.current;
    const geo = nodeGeometry(node, hover);
    const color = geo.color;
    // 選択中ノードがあれば、直接つながらないノードを大きく減光する
    const dimmed = connectedIds && !connectedIds.has(node.id);
    const emphasized = connectedIds && node.id === selectedId;

    if (geo.isEntity) {
      // Concept/Method/Representation は論文（円）と区別するため正方形で描く
      ctx.globalAlpha = dimmed ? 0.12 : 1;
      ctx.fillStyle = color;
      ctx.fillRect(node.x - geo.s / 2, node.y - geo.s / 2, geo.s, geo.s);
      ctx.globalAlpha = 1;
      if (hover || emphasized) drawHoverLabel(ctx, node, geo.s / 2 + 4 / scale, scale, `${ENTITY_LABELS[node.kind] ?? node.kind}: ${node.title}`);
      return;
    }

    const isContextOnly = isSearching && node.matched === false;
    const r = geo.r;
    if (!hover && !emphasized && r * scale < 1.6) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = dimmed ? 0.12 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSearching && node.matched ? color : '#ffffff';
    ctx.globalAlpha = dimmed ? 0.12 : (isContextOnly ? 0.5 : 1);
    ctx.fill();
    ctx.lineWidth = hover || emphasized ? 2.5 : 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (hover || emphasized) drawHoverLabel(ctx, node, r + 4 / scale, scale, node.title);
  }, [isSearching, nodeGeometry, connectedIds, selectedId]);

  const paintPointerArea = useCallback((node, color, ctx) => {
    const hover = node === hoverRef.current;
    const geo = nodeGeometry(node, hover);
    ctx.fillStyle = color;
    if (geo.isEntity) {
      ctx.fillRect(node.x - geo.s / 2, node.y - geo.s / 2, geo.s, geo.s);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, geo.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [nodeGeometry]);

  const onNodeHover = useCallback((node) => {
    hoverRef.current = node || null;
    setHoverNode(node || null);
  }, []);

  // シングルクリック=つながっているノードだけ強調表示（選択のトグル）。
  // ダブルクリック（同じノードを400ms以内に再クリック）=そのノード（論文でもConcept/Method/
  // Representationでも）を中心に局所マップを開く。
  const onNodeClick = useCallback((node) => {
    const now = Date.now();
    const isDoubleClick = lastClickRef.current.id === node.id && now - lastClickRef.current.time < 400;
    lastClickRef.current = { id: node.id, time: now };
    if (isDoubleClick) {
      onOpenPaper(node.kind === 'paper' ? node.id : node.ref);
      return;
    }
    setSelectedId((prev) => (prev === node.id ? null : node.id));
  }, [onOpenPaper]);

  const onBackgroundClick = useCallback(() => setSelectedId(null), []);

  // 右の一覧からノードを選ぶと、マップ側でも同じノードを選択（強調表示）し、その位置へ視点を移動する
  const onListItemSelect = useCallback((node) => {
    setSelectedId((prev) => (prev === node.id ? null : node.id));
    const fg = fgRef.current;
    if (fg && Number.isFinite(node.x) && Number.isFinite(node.y)) {
      fg.centerAt(node.x, node.y, 400);
      fg.zoom(4, 400);
    }
  }, []);

  return (
    <div className="map-view">
      <aside className="map-sidebar" aria-label="全体マップの説明・検索・フィルタ">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <h2>論文のつながりを俯瞰する</h2>
          <button className="btn" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => setShowList((v) => !v)}>
            {showList ? '一覧を隠す' : '一覧を表示'}
          </button>
        </div>
        <p>円1つ=論文1本（白い円の縁の色=カテゴリ、大きさ=類似論文の本数）、四角=Concept/Method/Representation。クリックでつながっているノードだけ強調表示、ダブルクリックでその論文を中心に局所マップを開きます。</p>
        {selectedId && (
          <p className="control-note">
            選択中: {data.nodes.find((n) => n.id === selectedId)?.title ?? selectedId}
            <button className="btn" style={{ marginLeft: 8, padding: '2px 8px' }} onClick={() => setSelectedId(null)}>選択解除</button>
          </p>
        )}
        <div className="map-totals" aria-live="polite">
          <div><strong>{data.nodes.filter((n) => n.kind === 'paper').length.toLocaleString()}</strong><span>表示中の論文</span></div>
          <div><strong>{data.links.length.toLocaleString()}</strong><span>表示中の関係</span></div>
          {(isSearching || showEntities) && (
            <div><strong>{data.nodes.filter((n) => n.kind !== 'paper').length.toLocaleString()}</strong><span>コンセプト等</span></div>
          )}
        </div>
        <section className="control-section">
          <label htmlFor="map-search">論文を検索</label>
          <div className="search-mode-tabs">
            <button className={searchMode === 'text' ? 'active' : ''} onClick={() => switchSearchMode('text')}>タイトル・要約</button>
            <button className={searchMode === 'semantic' ? 'active' : ''} onClick={() => switchSearchMode('semantic')}>意味検索</button>
          </div>
          <div className="search-input-row">
            <input
              id="map-search"
              className="search-input"
              placeholder={searchMode === 'text' ? 'タイトル・要約のキーワード' : '例: diffusion model, crystal structure'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (searchMode === 'semantic' && e.key === 'Enter') runSemanticSearch(); }}
            />
            {query.trim().length > 0 && (
              <button className="btn" onClick={() => { setQuery(''); setSemanticState({ status: 'idle', rows: [], entityHitCount: 0, paperHitCount: 0 }); }}>✕</button>
            )}
          </div>

          {searchMode === 'semantic' && (
            <div className="semantic-controls">
              <p className="control-note">
                クエリと、論文タイトル/要約およびConcept/Method/Representationの名称をブラウザ内で埋め込みベクトル化し、コサイン類似度で検索します（初回は軽量モデル ~25MB を読み込みます）。
              </p>
              <label className="range-caption" htmlFor="map-sem-threshold">類似度閾値 <strong>{semanticThreshold.toFixed(2)}</strong></label>
              <input id="map-sem-threshold" type="range" min="0.3" max="0.9" step="0.01" value={semanticThreshold}
                onChange={(e) => setSemanticThreshold(Number(e.target.value))} />
              <label className="range-caption" htmlFor="map-sem-limit">意味検索の候補数 <strong>{semanticLimit}</strong></label>
              <input id="map-sem-limit" type="range" min="5" max="100" step="5" value={semanticLimit}
                onChange={(e) => setSemanticLimit(Number(e.target.value))} />
              <button className="btn search-run-btn" onClick={runSemanticSearch} disabled={!query.trim() || semanticState.status === 'loading'}>
                {semanticState.status === 'loading' ? '検索中…' : '意味検索を実行'}
              </button>
              {semanticState.status === 'error' && <p className="control-note" style={{ color: '#9a3412' }}>読み込みに失敗しました: {semanticState.message}</p>}
            </div>
          )}

          {isSearching && (
            <>
              <p className="control-note">
                濃い円=一致した論文（{data.hitCount ?? 0}件）、薄い円=それらの類似論文（文脈として表示）、
                四角=一致論文が扱うConcept/Method/Representation。クリックで局所マップを開きます。
              </p>
              <div className="legend">
                <span><i style={{ borderColor: ENTITY_COLOR.concept }} />コンセプト</span>
                <span><i style={{ borderColor: ENTITY_COLOR.method }} />手法</span>
                <span><i style={{ borderColor: ENTITY_COLOR.representation }} />表現形式</span>
              </div>
              <div className="search-results" aria-live="polite">
                {searchMode === 'text' && results.map(({ url, paper }) => (
                  <button key={url} className="search-result" onClick={() => onOpenPaper(url)}>
                    <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
                    <br />{paper.title}
                  </button>
                ))}
                {searchMode === 'semantic' && (
                  <>
                    <p className="control-note">
                      類似Concept/Method/Representation {semanticState.entityHitCount}件・類似論文（タイトル/要約）{semanticState.paperHitCount}件がヒットしました。
                    </p>
                    {semanticState.rows.map(({ url, paper, match }) => (
                      <button key={url} className="search-result" onClick={() => onOpenPaper(url)}>
                        <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
                        <br />{paper.title}
                        <br />
                        <small>
                          {match.source === 'paper'
                            ? `タイトル/要約が類似 · 類似度 ${match.similarity.toFixed(2)}`
                            : `${ENTITY_LABELS[match.entityKind]}「${match.entityName}」 類似度 ${match.similarity.toFixed(2)}`}
                        </small>
                      </button>
                    ))}
                  </>
                )}
                {searchMode === 'text' && !results.length && <p>該当する論文がありません</p>}
              </div>
            </>
          )}
          {searchMode === 'semantic' && semanticState.status === 'done' && !semanticState.rows.length && (
            <p className="control-note">該当する論文がありません（閾値を下げてみてください）</p>
          )}
        </section>
        {!isSearching && (
          <>
            <section className="control-section">
              <h3>カテゴリ</h3>
              <div className="category-pills">
                {Object.entries(CATEGORIES).map(([key, label]) => {
                  const active = activeCategories.has(key);
                  const color = CATEGORY_TEXT_COLORS[key];
                  return (
                    <button key={key} aria-pressed={active} onClick={() => toggleCategory(key)}
                      style={{ color: active ? color : 'var(--text-2)', border: `1px solid ${active ? color : 'var(--border-strong)'}`, background: active ? `${color}14` : 'var(--bg)' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="control-section">
              <label className="range-caption" htmlFor="min-degree">最小類似論文数 <strong>{minDegree}</strong></label>
              <input id="min-degree" type="range" min="1" max="10" value={minDegree} onChange={(e) => setMinDegree(Number(e.target.value))} />
            </section>
            <section className="control-section">
              <h3>トピック</h3>
              <select value={topicFilter} onChange={(e) => setTopicFilter(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
                <option value="">すべてのトピック（{TOPIC_LIST.length}件）</option>
                {TOPIC_LIST.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}（{(t.size ?? 0).toLocaleString()}件）</option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={colorByTopic} onChange={(e) => setColorByTopic(e.target.checked)} />
                論文をトピックで色分け（オフ時はカテゴリで色分け）
              </label>
              {colorByTopic && (
                <p className="control-note">
                  円の縁の色がトピックごとに変わります（{TOPIC_LIST.length}色）。ノードにマウスを合わせると
                  トピック名を確認できます。
                </p>
              )}
            </section>
            <section className="control-section">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={showEntities} onChange={(e) => setShowEntities(e.target.checked)} />
                Concept/Method/Representationを表示
              </label>
              {showEntities && (
                <>
                  <p className="control-note">
                    四角=表示中の論文が扱うConcept/Method/Representation（接続数が多い上位{DEFAULT_ENTITY_BUDGET}件まで）。
                  </p>
                  <div className="legend">
                    <span><i style={{ borderColor: ENTITY_COLOR.concept }} />コンセプト</span>
                    <span><i style={{ borderColor: ENTITY_COLOR.method }} />手法</span>
                    <span><i style={{ borderColor: ENTITY_COLOR.representation }} />表現形式</span>
                  </div>
                </>
              )}
            </section>
          </>
        )}
        <section className="control-section">
          <label className="range-caption" htmlFor="max-nodes">表示件数の上限（可視化候補数） <strong>{maxNodes.toLocaleString()}</strong></label>
          <input id="max-nodes" type="range" min="100" max="10988" step="100" value={maxNodes} onChange={(e) => setMaxNodes(Number(e.target.value))} />
          <p className="control-note">類似論文数が多い順に上位{maxNodes.toLocaleString()}件だけを描画します（多いほど重くなります）。{data.truncated > 0 && `他 ${data.truncated.toLocaleString()} 件は非表示です。`}</p>
        </section>
      </aside>
      <div ref={wrapRef} className="map-canvas">
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="#ffffff"
          nodeId="id"
          nodeLabel={(n) => (n.kind === 'paper'
            ? `${n.title} · score ${n.score} · 類似論文${n.degree}件`
            : `${ENTITY_LABELS[n.kind] ?? n.kind}: ${n.title}`)}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={(l) => {
            const s = l.source.id ?? l.source;
            const t = l.target.id ?? l.target;
            const touches = selectedId && (s === selectedId || t === selectedId);
            if (selectedId) return touches ? '#0369a1cc' : 'rgba(148,163,184,0.04)';
            return l.kind === 'entity' ? `${ENTITY_COLOR[l.entityKind] ?? '#94a3b8'}55` : 'rgba(148,163,184,0.35)';
          }}
          linkWidth={(l) => {
            const s = l.source.id ?? l.source;
            const t = l.target.id ?? l.target;
            const touches = selectedId && (s === selectedId || t === selectedId);
            if (touches) return 2;
            return l.kind === 'entity' ? 0.8 : 0.6;
          }}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
          onBackgroundClick={onBackgroundClick}
          onEngineStop={onEngineStop}
          warmupTicks={30}
          cooldownTime={3000}
          minZoom={0.1}
          maxZoom={16}
        />
        {!data.nodes.length && (
          <div className="map-empty" role="status">
            <strong>表示できる論文がありません</strong>
            <span>{isSearching ? '別のキーワードを試してください。' : 'カテゴリを選択するか、最小類似論文数を下げてください。'}</span>
          </div>
        )}
        {hoverNode && hoverNode.kind === 'paper' && (
          <div className="map-hover">
            <strong>{hoverNode.title}</strong>
            <small>
              {CATEGORIES[hoverNode.category] ?? hoverNode.category}
              {hoverNode.topicId && TOPICS[hoverNode.topicId] && ` · ${TOPICS[hoverNode.topicId].label}`}
              {' '}· score {hoverNode.score} · 類似論文 {hoverNode.degree}件
            </small>
          </div>
        )}
        {hoverNode && hoverNode.kind !== 'paper' && (
          <div className="map-hover">
            <strong>{hoverNode.title}</strong>
            <small>{ENTITY_LABELS[hoverNode.kind] ?? hoverNode.kind} · {hoverNode.degree}件の論文と接続</small>
          </div>
        )}
      </div>
      {showList && (
        <aside className="map-list-panel" aria-label="表示中の一覧">
          <div className="map-list-header">
            <h3>表示中の一覧</h3>
            <span className="table-count">{nodeList.length.toLocaleString()} 件</span>
          </div>
          <div className="list-kind-tabs">
            {[['paper', '論文'], ['concept', ENTITY_LABELS.concept], ['method', ENTITY_LABELS.method], ['representation', ENTITY_LABELS.representation]].map(([kind, label]) => (
              <button
                key={kind}
                className={listKindFilter === kind ? 'active' : ''}
                disabled={!listKindCounts[kind]}
                onClick={() => setListKindFilter(kind)}
              >
                {label} ({listKindCounts[kind].toLocaleString()})
              </button>
            ))}
          </div>
          <p className="control-note">クリックでマップ上のそのノードを選択・拡大します。</p>
          <div className="map-list-items">
            {listPageItems.map((p) => (
              <button
                key={p.id}
                className={`map-list-row${p.id === selectedId ? ' active' : ''}`}
                onClick={() => onListItemSelect(p)}
              >
                {p.kind === 'paper' ? (
                  <>
                    <span className="paper-row-cat" style={{ color: CATEGORY_TEXT_COLORS[p.category] }}>
                      {CATEGORIES[p.category] ?? p.category}
                    </span>
                    <span className="map-list-title">{p.title}</span>
                    <span className="map-list-meta">score {p.score} · 類似論文{p.degree}件</span>
                  </>
                ) : (
                  <>
                    <span className="paper-row-cat" style={{ color: ENTITY_COLOR[p.kind] }}>
                      {ENTITY_LABELS[p.kind] ?? p.kind}
                    </span>
                    <span className="map-list-title">{p.title}</span>
                    <span className="map-list-meta">{p.degree}件の論文と接続</span>
                  </>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="link-cell map-list-open"
                  onClick={(e) => { e.stopPropagation(); onOpenPaper(p.kind === 'paper' ? p.id : p.ref); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpenPaper(p.kind === 'paper' ? p.id : p.ref); } }}
                >
                  局所マップを開く ↗
                </span>
              </button>
            ))}
            {!listPageItems.length && <p className="detail-empty">表示中の{listKindFilter === 'paper' ? '論文' : ENTITY_LABELS[listKindFilter]}がありません</p>}
          </div>
          <div className="table-pagination">
            <button disabled={listPage === 0} onClick={() => setListPage((p) => p - 1)}>← 前へ</button>
            <span>{listPage + 1} / {listPageCount}</span>
            <button disabled={listPage >= listPageCount - 1} onClick={() => setListPage((p) => p + 1)}>次へ →</button>
          </div>
        </aside>
      )}
    </div>
  );
}
