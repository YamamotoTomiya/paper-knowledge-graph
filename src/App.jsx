import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { CATEGORY_TEXT_COLORS, PAPER_ENTRIES, STATS, nodeInfo, nodeKey } from './data/graph.js';
import { buildEgoNetwork } from './flow/egoNetwork.js';
import { useForceLayout } from './flow/useForceLayout.js';
import { nodeTypes } from './flow/nodeTypes.jsx';
import SearchSidebar from './components/SearchSidebar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import PaperTable from './components/PaperTable.jsx';
import RelationTable from './components/RelationTable.jsx';
import StatsView from './components/StatsView.jsx';
import GlobalMap from './components/GlobalMap.jsx';

const DEFAULT_URL = [...PAPER_ENTRIES].sort((a, b) => b.score - a.score)[0]?.url ?? null;
const DEFAULT_MAX_NEIGHBORS = 100;

// GlobalMap/PaperTable/RelationTable/StatsViewは従来どおり論文URL文字列を渡してくる呼び出しが
// 大半なので、それらを {kind:'paper', key:url} に正規化する（{kind,key}のrefはそのまま通す）。
function toRef(refOrUrl) {
  return typeof refOrUrl === 'string' ? { kind: 'paper', key: refOrUrl } : refOrUrl;
}

function Header({ view, setView }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">◉</span>
        <div>
          <span className="brand-kicker">PAPER KNOWLEDGE GRAPH</span>
          <h1>論文ナレッジグラフ</h1>
        </div>
      </div>
      <nav aria-label="表示切り替え" className="view-tabs">
        {Object.entries({ map: '全体マップ', graph: '関係グラフ', table: '論文一覧', relations: '関係一覧', stats: '統計' }).map(([key, label]) => (
          <button
            key={key}
            aria-current={view === key ? 'page' : undefined}
            className={view === key ? 'active' : ''}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </header>
  );
}

// たどってきた経路をパンくずリストとして表示する。中心ノードだけでなく途中の経路も
// クリックで直接戻れる（従来は直前の1件にしか戻れなかった）。
function nodeLabelFor(ref) {
  const info = nodeInfo(ref);
  return (ref.kind === 'paper' ? info?.title : info?.name) ?? ref.key;
}

function BreadcrumbBar({ history, centerRef, onJump }) {
  if (history.length === 0) return null;
  const trail = [...history, centerRef];
  return (
    <div className="breadcrumb-bar" aria-label="閲覧履歴">
      {trail.map((ref, i) => {
        const isLast = i === trail.length - 1;
        return (
          <React.Fragment key={`${nodeKey(ref)}-${i}`}>
            {i > 0 && <span className="breadcrumb-sep">›</span>}
            {isLast ? (
              <span className="breadcrumb-current" title={nodeLabelFor(ref)}>{nodeLabelFor(ref)}</span>
            ) : (
              <button className="breadcrumb-item" title={nodeLabelFor(ref)} onClick={() => onJump(i)}>
                {nodeLabelFor(ref)}
              </button>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ホバー中ノードの接続本数がこれ以下の時だけ、そのノードのエッジに種別・スコアのラベルを出す。
// 隣接数の多いノード（中心など）で全ラベルを出すと重なって読めなくなるため。
const HOVER_LABEL_MAX_EDGES = 8;

function GraphView({ centerRef, setCenterRef }) {
  const [selection, setSelection] = useState(null);
  const [history, setHistory] = useState([]);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  const [maxNeighbors, setMaxNeighbors] = useState(DEFAULT_MAX_NEIGHBORS);
  // React Flowが計測したノードの実サイズ。ノード配列は毎回作り直すので、計測結果を自分で
  // 保持して渡さないとReact Flowが「サイズ未確定」を繰り返し検出し、エッジの接続点が
  // 定まらず点滅して見える（JP_Market_Vis App.jsx の GraphView と同じ対策）。
  const [measured, setMeasured] = useState({});
  const onNodesChange = useCallback((changes) => {
    setMeasured((prev) => {
      let next = null;
      for (const c of changes) if (c.type === 'dimensions' && c.dimensions) (next ??= { ...prev })[c.id] = c.dimensions;
      return next ?? prev;
    });
  }, []);

  const centerKey = nodeKey(centerRef);
  const { nodes, edges, truncated } = useMemo(
    () => buildEgoNetwork(centerRef, { maxNeighbors }),
    [centerRef, maxNeighbors],
  );

  // 全体マップと同じように、力学シミュレーション（反発・リンクの引き合い・衝突回避）で
  // ノードが自然に動いて落ち着くようにする。buildEgoNetwork() のセクター配置は初期値として使う。
  const forcePositions = useForceLayout(nodes, edges);

  // ノードをドラッグした位置を記憶する（このstateが無いと、常にシミュレーション/セクター配置の
  // 座標で上書きされてしまい、ドラッグしても手を離した瞬間に元の位置へ戻ってしまう）。
  // 中心が変わったら（新しいエゴネットワークになるので）リセットする。
  const [dragOverrides, setDragOverrides] = useState({});
  useEffect(() => setDragOverrides({}), [nodes]);
  const onNodeDragStop = useCallback((_, node) => {
    setDragOverrides((prev) => ({ ...prev, [node.id]: node.position }));
  }, []);

  // ホバー中のノードがあればそれを、無ければ「クリックして選んだノード」を強調対象にする。
  // これによりクリックした後マウスを離してもハイライトが残り、詳細パネルを読みながら
  // どのノードの繋がりか確認できる（ホバーだけだとマウスを動かすと消えてしまうため）。
  const selectedNodeId = selection?.kind === 'node' ? nodeKey(selection.ref) : null;
  const highlightNodeId = hoveredNodeId ?? selectedNodeId;

  const displayNodes = useMemo(() => {
    const connected = new Set([highlightNodeId]);
    if (highlightNodeId) {
      for (const e of edges) {
        if (e.source === highlightNodeId) connected.add(e.target);
        if (e.target === highlightNodeId) connected.add(e.source);
      }
    }
    return nodes.map((n) => ({
      ...n,
      position: dragOverrides[n.id] ?? forcePositions[n.id] ?? n.position,
      measured: measured[n.id],
      data: { ...n.data, dimmed: highlightNodeId ? !connected.has(n.id) : false },
    }));
  }, [nodes, edges, highlightNodeId, measured, forcePositions, dragOverrides]);

  // 強調中ノードに繋がるエッジの本数（ラベルを出しても重ならないくらい少ないか判定するため）
  const hoverNodeEdgeCount = useMemo(
    () => (highlightNodeId ? edges.filter((e) => e.source === highlightNodeId || e.target === highlightNodeId).length : 0),
    [edges, highlightNodeId],
  );

  // 通常時のエッジは無地（矢印・線のみ）。強調中のノード/エッジだけ強調し、
  // 繋がりが少ない時だけ種別・スコアのラベルを添える（JP_Market_Vis の displayEdges と同じ方針）。
  const displayEdges = useMemo(() => {
    const labelOk = hoverNodeEdgeCount > 0 && hoverNodeEdgeCount <= HOVER_LABEL_MAX_EDGES;
    return edges.map((e) => {
      const touchesHighlight = highlightNodeId && (e.source === highlightNodeId || e.target === highlightNodeId);
      const isHoverEdge = e.id === hoveredEdgeId;
      if (!highlightNodeId && !isHoverEdge) return e;
      const dim = highlightNodeId && !touchesHighlight;
      const emphasize = isHoverEdge || touchesHighlight;
      const withLabel = isHoverEdge || (touchesHighlight && labelOk);
      const label = withLabel
        ? `${e.data.typeJa}${e.data.scoreVal != null ? ` ${e.data.scoreVal.toFixed(2)}` : ''}`
        : '';
      return {
        ...e,
        label,
        style: {
          ...e.style,
          opacity: dim ? 0.1 : emphasize ? 1 : e.style.opacity,
          strokeWidth: emphasize ? 2.6 : e.style.strokeWidth,
        },
      };
    });
  }, [edges, highlightNodeId, hoveredEdgeId, hoverNodeEdgeCount]);

  // クリック = 詳細表示（中心ノードも含め、表示中のどの論文/エンティティでも共通）。
  // 中心を切り替える「関係グラフを開く」操作はダブルクリック、または詳細パネルの
  // ボタンから明示的に行う（クリックしただけで中心が変わると誤操作しやすいため）。
  const onNodeClick = useCallback((_, node) => {
    setSelection({ kind: 'node', ref: node.data.ref, info: nodeInfo(node.data.ref) });
  }, []);

  const recenterOn = useCallback((ref) => {
    if (nodeKey(ref) === centerKey) return;
    setHistory((h) => [...h, centerRef]);
    setCenterRef(ref);
    setSelection(null);
  }, [centerKey, centerRef, setCenterRef]);

  // ダブルクリックはノード種別を問わず、いま表示中のどのノード（論文でもConcept/Method/
  // Representationでも）を中心にした関係グラフにも切り替えられるようにする。
  const onNodeDoubleClick = useCallback((_, node) => {
    recenterOn(node.data.ref);
  }, [recenterOn]);

  const onEdgeClick = useCallback((_, edge) => setSelection({ kind: 'edge', relation: edge.data.relation }), []);
  const onNodeMouseEnter = useCallback((_, node) => setHoveredNodeId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredNodeId(null), []);
  const onEdgeMouseEnter = useCallback((_, edge) => setHoveredEdgeId(edge.id), []);
  const onEdgeMouseLeave = useCallback(() => setHoveredEdgeId(null), []);

  // パンくずの任意の地点（index）をクリックしたら、そこを中心に戻し、それより先の経路は破棄する。
  const jumpTo = useCallback((index) => {
    setHistory((h) => {
      if (index < 0 || index >= h.length) return h;
      setCenterRef(h[index]);
      setSelection(null);
      return h.slice(0, index);
    });
  }, [setCenterRef]);

  const handleSidebarSelect = useCallback((url) => {
    const ref = { kind: 'paper', key: url };
    if (nodeKey(ref) !== centerKey) {
      setHistory([]);
      setCenterRef(ref);
      setSelection(null);
    }
  }, [centerKey, setCenterRef]);

  if (!centerRef) return <p className="detail-empty">論文がありません。</p>;

  return (
    <div className="graph-view">
      <SearchSidebar selectedUrl={centerRef.kind === 'paper' ? centerRef.key : null} onSelect={handleSidebarSelect} />
      <div className="ego-canvas">
        <div className="overlay-stack overlay-stack-left">
          <div className="overlay-box graph-caption">
            点線=類似論文のさらに類似論文（間接）。クリックで詳細表示とつながりの強調、ダブルクリックでそのノードを中心に表示します。
            論文だけでなくConcept/Method/Representationも中心にできます。
          </div>
          <BreadcrumbBar history={history} centerRef={centerRef} onJump={jumpTo} />
        </div>
        <div className="overlay-box graph-settings">
          <label className="range-caption" htmlFor="max-neighbors">可視化候補数 <strong>{maxNeighbors}</strong></label>
          <input id="max-neighbors" type="range" min="20" max="400" step="10" value={maxNeighbors}
            onChange={(e) => setMaxNeighbors(Number(e.target.value))} />
        </div>
        {truncated > 0 && (
          <div className="overlay-box truncated-note">
            関連が多いため {truncated} 件を省略表示中（種別ごとに比例配分）。
          </div>
        )}
        <ReactFlow
          key={centerKey}
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onEdgeClick={onEdgeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onEdgeMouseEnter={onEdgeMouseEnter}
          onEdgeMouseLeave={onEdgeMouseLeave}
          onPaneClick={() => setSelection(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.1}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#cbd5e1" gap={24} />
          <Controls />
          <MiniMap
            style={{ background: '#f8fafc' }}
            nodeColor={(n) => (n.type === 'center' ? '#0369a1' : n.type === 'paper' ? CATEGORY_TEXT_COLORS[n.data.category] ?? '#94a3b8' : '#cbd5e1')}
            maskColor="rgba(248, 250, 252, 0.7)"
          />
        </ReactFlow>
      </div>
      <DetailPanel selection={selection} centerKey={centerKey} onClose={() => setSelection(null)} onCenterNode={recenterOn} />
    </div>
  );
}

function ViewPane({ active, children }) {
  return (
    <div className={`view-pane${active ? '' : ' view-pane-hidden'}`} aria-hidden={!active} inert={active ? undefined : ''}>
      {children}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('map');
  const [centerRef, setCenterRef] = useState(() => ({ kind: 'paper', key: DEFAULT_URL }));
  const [visited, setVisited] = useState(() => new Set(['map']));

  const showView = useCallback((key) => {
    setVisited((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    setView(key);
  }, []);

  // 論文URL文字列（GlobalMap/PaperTable/RelationTable/StatsViewの既存呼び出し）、
  // {kind,key}のref（Concept/Method/Representationを中心にする場合）のどちらも受け付ける。
  const openGraph = useCallback((refOrUrl) => {
    setCenterRef(toRef(refOrUrl));
    showView('graph');
  }, [showView]);

  return (
    <div className="app-shell">
      <Header view={view} setView={showView} />
      <ViewPane active={view === 'map'}>
        <GlobalMap onOpenPaper={openGraph} />
      </ViewPane>
      {visited.has('graph') && (
        <ViewPane active={view === 'graph'}><GraphView centerRef={centerRef} setCenterRef={setCenterRef} /></ViewPane>
      )}
      {visited.has('table') && (
        <ViewPane active={view === 'table'}><PaperTable onOpenGraph={openGraph} /></ViewPane>
      )}
      {visited.has('relations') && (
        <ViewPane active={view === 'relations'}><RelationTable onOpenPaper={openGraph} /></ViewPane>
      )}
      {visited.has('stats') && (
        <ViewPane active={view === 'stats'}><StatsView onOpenPaper={openGraph} /></ViewPane>
      )}
      <footer className="app-footer">
        <span>収録 {STATS.papers.toLocaleString()}論文 · {STATS.relations.toLocaleString()}関係 · {STATS.topics.toLocaleString()}トピック</span>
        <span>paper-bot が日次収集・評価した論文を自動でグラフ化。AI要約・スコアはLLMによる自動評価です。</span>
      </footer>
    </div>
  );
}
