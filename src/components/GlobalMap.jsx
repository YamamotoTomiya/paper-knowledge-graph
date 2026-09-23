import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import {
  CATEGORIES, CATEGORY_TEXT_COLORS, ENTITY_LABELS, PAPERS, PAPER_GLOBAL_GRAPH,
  neighborsOf, nodeKey, nodeName, searchPapers,
} from '../data/graph.js';

// JP_Market_Vis の全体マップ（白い円+業種色の縁、円の大きさ=関係数）を踏襲。
// ノード=論文（SIMILAR_TOを持つものだけ）、縁の色=カテゴリ、大きさ=SIMILAR_TO本数(degree)。
const nodeRadius = (degree) => Math.max(2.5, Math.min(22, Math.sqrt(degree) * 4));
const AVAILABLE_CATEGORIES = Object.keys(CATEGORIES);
const DEFAULT_MAX_NODES = 1500;
const DEFAULT_ENTITY_BUDGET = 250;
const SEARCH_HIT_LIMIT = 25;
const SEARCH_CONTEXT_PER_HIT = 5;
const SEARCH_ENTITIES_PER_HIT = 6;
const ENTITY_COLOR = { concept: '#166534', method: '#9a3412', representation: '#6d28d9' };

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ノード上部にホバー時のラベル（白背景付き）を描く共通処理。offsetY=ノード上端からの距離
function drawHoverLabel(ctx, node, offsetY, scale, text) {
  ctx.font = `600 ${12 / scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  const y = node.y - offsetY;
  const w = ctx.measureText(label).width + 8 / scale;
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillRect(node.x - w / 2, y - 12 / scale, w, 14 / scale);
  ctx.fillStyle = '#0f172a';
  ctx.fillText(label, node.x, y);
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
      if (!entityInfo.has(id)) entityInfo.set(id, { kind: nb.other.kind, title: nodeName(nb.other) });
    }
  }
  const topIds = new Set(
    [...entityCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, budget).map(([id]) => id),
  );
  const entityNodes = [...topIds].map((id) => ({
    id, kind: entityInfo.get(id).kind, title: entityInfo.get(id).title, degree: entityCount.get(id),
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

function filterGraph(activeCategories, minDegree, maxNodes, showEntities) {
  let paperNodes = PAPER_GLOBAL_GRAPH.nodes.filter(
    (n) => activeCategories.has(n.category) && n.degree >= minDegree,
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

// キーワードに一致した論文＋その類似論文（文脈）＋一致論文が扱うConcept/Method/Representation
// で構成する部分グラフを作る。一致論文だけだと互いに孤立した点の羅列になりがちなので、
// SIMILAR_TOで繋がる周辺論文と、論文が実際に何を扱っているか（コンセプト等）を合わせて見せる
// ことで「関連する論文のナレッジグラフ」として見えるようにする。
function buildSearchGraph(query, maxNodes) {
  const hits = searchPapers(query, SEARCH_HIT_LIMIT);
  const nodeMap = new Map(); // id (url or "kind:name") -> node
  const addPaper = (url, matched) => {
    const p = PAPERS[url];
    if (!p) return;
    const existing = nodeMap.get(url);
    if (existing) { existing.matched = existing.matched || matched; return; }
    const degree = neighborsOf({ kind: 'paper', key: url }).filter((n) => n.other.kind === 'paper').length;
    nodeMap.set(url, { id: url, kind: 'paper', title: p.title, category: p.category || 'uncategorized', score: p.score, degree, matched });
  };
  for (const { url } of hits) addPaper(url, true);
  for (const { url } of hits) {
    const nbs = neighborsOf({ kind: 'paper', key: url })
      .filter((n) => n.other.kind === 'paper')
      .sort((a, b) => (b.relation.score ?? 0) - (a.relation.score ?? 0))
      .slice(0, SEARCH_CONTEXT_PER_HIT);
    for (const nb of nbs) addPaper(nb.other.key, false);
  }

  // 一致論文が扱うConcept/Method/Representationも加える（graph_app.py の検索結果グラフに
  // Concept/Method/Representationノードを含めていたのと同じ考え方）
  const entityLinks = []; // {source: paperUrl, target: entityId}
  for (const { url } of hits) {
    const entityNbs = neighborsOf({ kind: 'paper', key: url })
      .filter((n) => n.other.kind !== 'paper')
      .slice(0, SEARCH_ENTITIES_PER_HIT);
    for (const nb of entityNbs) {
      const id = nodeKey(nb.other);
      if (!nodeMap.has(id)) {
        nodeMap.set(id, { id, kind: nb.other.kind, title: nodeName(nb.other), degree: 1, matched: true });
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
  return { nodes, links, truncated: Math.max(0, totalMatching - nodes.length), hitCount: hits.length };
}

export default function GlobalMap({ onOpenPaper }) {
  const fgRef = useRef(null);
  const wrapRef = useRef(null);
  const hoverRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoverNode, setHoverNode] = useState(null);
  const [activeCategories, setActiveCategories] = useState(new Set(AVAILABLE_CATEGORIES));
  const [minDegree, setMinDegree] = useState(1);
  const [maxNodes, setMaxNodes] = useState(DEFAULT_MAX_NODES);
  const [showEntities, setShowEntities] = useState(true);
  const [query, setQuery] = useState('');
  // グラフの再構築は毎回の入力・スライダー操作のたびに行わず、操作が止まってから行う。
  // 毎回作り直すとForceGraph2Dが完全新規データとして扱い、ノード位置がリセットされて
  // 画面がちらつく（エッジが点滅して見える）ため（検索ボックス・スライダー共通の対策）。
  const debouncedQuery = useDebouncedValue(query, 350);
  const debouncedActiveCategories = useDebouncedValue(activeCategories, 300);
  const debouncedMinDegree = useDebouncedValue(minDegree, 300);
  const debouncedMaxNodes = useDebouncedValue(maxNodes, 300);
  const isSearching = debouncedQuery.trim().length > 0;
  const results = useMemo(() => (isSearching ? searchPapers(debouncedQuery, 12) : []), [isSearching, debouncedQuery]);

  useEffect(() => {
    const el = wrapRef.current;
    const resize = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => (isSearching
      ? buildSearchGraph(debouncedQuery, debouncedMaxNodes)
      : filterGraph(debouncedActiveCategories, debouncedMinDegree, debouncedMaxNodes, showEntities)),
    [isSearching, debouncedQuery, debouncedActiveCategories, debouncedMinDegree, debouncedMaxNodes, showEntities],
  );

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
    return { isEntity: false, r, color: CATEGORY_TEXT_COLORS[node.category] ?? '#94a3b8' };
  }, [isSearching]);

  const drawNode = useCallback((node, ctx, scale) => {
    const hover = node === hoverRef.current;
    const geo = nodeGeometry(node, hover);
    const color = geo.color;

    if (geo.isEntity) {
      // Concept/Method/Representation は論文（円）と区別するため正方形で描く
      ctx.fillStyle = color;
      ctx.fillRect(node.x - geo.s / 2, node.y - geo.s / 2, geo.s, geo.s);
      if (hover) drawHoverLabel(ctx, node, geo.s / 2 + 4 / scale, scale, `${ENTITY_LABELS[node.kind] ?? node.kind}: ${node.title}`);
      return;
    }

    const isContextOnly = isSearching && node.matched === false;
    const r = geo.r;
    if (!hover && r * scale < 1.6) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isSearching && node.matched ? color : '#ffffff';
    ctx.globalAlpha = isContextOnly ? 0.5 : 1;
    ctx.fill();
    ctx.lineWidth = hover ? 2.5 : 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (hover) drawHoverLabel(ctx, node, r + 4 / scale, scale, node.title);
  }, [isSearching, nodeGeometry]);

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

  const onNodeClick = useCallback((node) => {
    if (node.kind === 'paper') onOpenPaper(node.id);
  }, [onOpenPaper]);

  return (
    <div className="map-view">
      <aside className="map-sidebar" aria-label="全体マップの説明・検索・フィルタ">
        <h2>論文のつながりを俯瞰する</h2>
        <p>円1つ=論文1本（白い円の縁の色=カテゴリ、大きさ=類似論文の本数）、四角=Concept/Method/Representation。論文をクリックするとその論文を中心に関係グラフが開きます。</p>
        <div className="map-totals" aria-live="polite">
          <div><strong>{data.nodes.filter((n) => n.kind === 'paper').length.toLocaleString()}</strong><span>表示中の論文</span></div>
          <div><strong>{data.links.length.toLocaleString()}</strong><span>表示中の関係</span></div>
          {(isSearching || showEntities) && (
            <div><strong>{data.nodes.filter((n) => n.kind !== 'paper').length.toLocaleString()}</strong><span>コンセプト等</span></div>
          )}
        </div>
        <section className="control-section">
          <label htmlFor="map-search">論文を検索</label>
          <div className="search-input-row">
            <input id="map-search" className="search-input" placeholder="タイトル・要約のキーワード" value={query} onChange={(e) => setQuery(e.target.value)} />
            {isSearching && <button className="btn" onClick={() => setQuery('')}>✕</button>}
          </div>
          {isSearching && (
            <>
              <p className="control-note">
                濃い円=一致した論文（{data.hitCount ?? 0}件）、薄い円=それらの類似論文（文脈として表示）、
                四角=一致論文が扱うConcept/Method/Representation。クリックで関係グラフを開きます。
              </p>
              <div className="legend">
                <span><i style={{ borderColor: ENTITY_COLOR.concept }} />コンセプト</span>
                <span><i style={{ borderColor: ENTITY_COLOR.method }} />手法</span>
                <span><i style={{ borderColor: ENTITY_COLOR.representation }} />表現形式</span>
              </div>
              <div className="search-results" aria-live="polite">
                {results.map(({ url, paper }) => (
                  <button key={url} className="search-result" onClick={() => onOpenPaper(url)}>
                    <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
                    <br />{paper.title}
                  </button>
                ))}
                {!results.length && <p>該当する論文がありません</p>}
              </div>
            </>
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
          linkColor={(l) => (l.kind === 'entity' ? `${ENTITY_COLOR[l.entityKind] ?? '#94a3b8'}55` : 'rgba(148,163,184,0.35)')}
          linkWidth={(l) => (l.kind === 'entity' ? 0.8 : 0.6)}
          onNodeHover={onNodeHover}
          onNodeClick={onNodeClick}
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
            <small>{CATEGORIES[hoverNode.category] ?? hoverNode.category} · score {hoverNode.score} · 類似論文 {hoverNode.degree}件</small>
          </div>
        )}
        {hoverNode && hoverNode.kind !== 'paper' && (
          <div className="map-hover">
            <strong>{hoverNode.title}</strong>
            <small>{ENTITY_LABELS[hoverNode.kind] ?? hoverNode.kind} · {hoverNode.degree}件の論文と接続</small>
          </div>
        )}
      </div>
    </div>
  );
}
