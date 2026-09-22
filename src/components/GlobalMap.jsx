import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { CATEGORIES, CATEGORY_TEXT_COLORS, PAPER_GLOBAL_GRAPH, searchPapers } from '../data/graph.js';

// JP_Market_Vis の全体マップ（白い円+業種色の縁、円の大きさ=関係数）を踏襲。
// ノード=論文（SIMILAR_TOを持つものだけ）、縁の色=カテゴリ、大きさ=SIMILAR_TO本数(degree)。
const nodeRadius = (degree) => Math.max(2.5, Math.min(22, Math.sqrt(degree) * 4));
const AVAILABLE_CATEGORIES = Object.keys(CATEGORIES);
const DEFAULT_MAX_NODES = 1500;

function filterGraph(activeCategories, minDegree, maxNodes) {
  let nodes = PAPER_GLOBAL_GRAPH.nodes.filter(
    (n) => activeCategories.has(n.category) && n.degree >= minDegree,
  );
  const totalMatching = nodes.length;
  nodes = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, maxNodes);
  const ids = new Set(nodes.map((n) => n.id));
  const links = PAPER_GLOBAL_GRAPH.links.filter(
    (l) => ids.has(l.source.id ?? l.source) && ids.has(l.target.id ?? l.target),
  );
  return { nodes, links, truncated: Math.max(0, totalMatching - nodes.length) };
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
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? searchPapers(query, 12) : []), [query]);

  useEffect(() => {
    const el = wrapRef.current;
    const resize = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => filterGraph(activeCategories, minDegree, maxNodes),
    [activeCategories, minDegree, maxNodes],
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

  const drawNode = useCallback((node, ctx, scale) => {
    const hover = node === hoverRef.current;
    const color = CATEGORY_TEXT_COLORS[node.category] ?? '#94a3b8';
    const r = nodeRadius(node.degree) * (hover ? 1.4 : 1);
    if (!hover && r * scale < 1.6) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = hover ? 2.5 : 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (hover) {
      ctx.font = `600 ${12 / scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#0f172a';
      const label = node.title.length > 60 ? `${node.title.slice(0, 60)}…` : node.title;
      const y = node.y - r - 4 / scale;
      const w = ctx.measureText(label).width + 8 / scale;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillRect(node.x - w / 2, y - 12 / scale, w, 14 / scale);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, node.x, y);
    }
  }, []);

  const paintPointerArea = useCallback((node, color, ctx) => {
    const hover = node === hoverRef.current;
    const r = nodeRadius(node.degree) * (hover ? 1.4 : 1);
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  const onNodeHover = useCallback((node) => {
    hoverRef.current = node || null;
    setHoverNode(node || null);
  }, []);

  const onNodeClick = useCallback((node) => onOpenPaper(node.id), [onOpenPaper]);

  return (
    <div className="map-view">
      <aside className="map-sidebar" aria-label="全体マップの説明・検索・フィルタ">
        <h2>論文のつながりを俯瞰する</h2>
        <p>円1つ=論文1本。白い円の縁の色=カテゴリ、大きさ=類似論文の本数。クリックするとその論文を中心に関係グラフが開きます。</p>
        <div className="map-totals" aria-live="polite">
          <div><strong>{data.nodes.length.toLocaleString()}</strong><span>表示中の論文</span></div>
          <div><strong>{data.links.length.toLocaleString()}</strong><span>表示中の類似関係</span></div>
        </div>
        <section className="control-section">
          <label htmlFor="map-search">論文を検索</label>
          <input id="map-search" className="search-input" placeholder="タイトル・要約のキーワード" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query.trim() && (
            <div className="search-results" aria-live="polite">
              {results.map(({ url, paper }) => (
                <button key={url} className="search-result" onClick={() => onOpenPaper(url)}>
                  <span style={{ color: CATEGORY_TEXT_COLORS[paper.category] }}>{CATEGORIES[paper.category] ?? paper.category}</span>
                  <br />{paper.title}
                </button>
              ))}
              {!results.length && <p>該当する論文がありません</p>}
            </div>
          )}
        </section>
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
          nodeLabel={(n) => `${n.title} · score ${n.score} · 類似論文${n.degree}件`}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={() => 'rgba(148,163,184,0.35)'}
          linkWidth={0.6}
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
            <span>カテゴリを選択するか、最小類似論文数を下げてください。</span>
          </div>
        )}
        {hoverNode && (
          <div className="map-hover">
            <strong>{hoverNode.title}</strong>
            <small>{CATEGORIES[hoverNode.category] ?? hoverNode.category} · score {hoverNode.score} · 類似論文 {hoverNode.degree}件</small>
          </div>
        )}
      </div>
    </div>
  );
}
