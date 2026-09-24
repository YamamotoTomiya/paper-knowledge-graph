import React, { useCallback, useState } from 'react';

import { PAPER_ENTRIES, STATS, nodeInfo, nodeKey } from './data/graph.js';
import EgoGraph from './components/EgoGraph.jsx';
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

function GraphView({ centerRef, setCenterRef }) {
  const [selection, setSelection] = useState(null);
  const [history, setHistory] = useState([]);
  const [maxNeighbors, setMaxNeighbors] = useState(DEFAULT_MAX_NEIGHBORS);

  const centerKey = nodeKey(centerRef);
  const selectedNodeId = selection?.kind === 'node' ? nodeKey(selection.ref) : null;

  // クリック = 詳細表示（中心ノードも含め、表示中のどの論文/エンティティでも共通）。
  // 中心を切り替える「関係グラフを開く」操作はダブルクリック、または詳細パネルの
  // ボタンから明示的に行う（クリックしただけで中心が変わると誤操作しやすいため）。
  const onNodeClick = useCallback((ref) => {
    setSelection({ kind: 'node', ref, info: nodeInfo(ref) });
  }, []);

  const recenterOn = useCallback((ref) => {
    if (nodeKey(ref) === centerKey) return;
    setHistory((h) => [...h, centerRef]);
    setCenterRef(ref);
    setSelection(null);
  }, [centerKey, centerRef, setCenterRef]);

  const onEdgeClick = useCallback((relation) => setSelection({ kind: 'edge', relation }), []);

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
      <EgoGraph
        centerRef={centerRef}
        maxNeighbors={maxNeighbors}
        selectedNodeId={selectedNodeId}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={recenterOn}
        onEdgeClick={onEdgeClick}
        onBackgroundClick={() => setSelection(null)}
        overlays={(
          <>
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
          </>
        )}
      />
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
