import React from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, ENTITY_LABELS, RELATION_TYPE_JA, degreeOf, nodeKey } from '../data/graph.js';

function PaperDetail({ url, paper, isCenter, onCenterNode }) {
  const color = CATEGORY_TEXT_COLORS[paper.category] ?? '#475569';
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 4 }}>
        {CATEGORIES[paper.category] ?? paper.category}
      </div>
      <h3 style={{ margin: '0 0 8px' }}>{paper.title}</h3>
      <div className="detail-meta">
        <span>score {paper.score}</span>
        <span>{paper.source}</span>
        <span>{paper.logged_at?.slice(0, 10)}</span>
      </div>
      {paper.ai_summary && (
        <section>
          <h4>AI要約</h4>
          <p>{paper.ai_summary}</p>
        </section>
      )}
      {paper.reason && (
        <section>
          <h4>採用理由</h4>
          <p>{paper.reason}</p>
        </section>
      )}
      <section>
        <h4>Abstract</h4>
        <p className="abstract">{paper.abstract}</p>
      </section>
      <div className="detail-actions">
        <a className="btn" href={url} target="_blank" rel="noreferrer">論文を開く ↗</a>
        {!isCenter && onCenterNode && (
          <button className="btn" onClick={() => onCenterNode({ kind: 'paper', key: url })}>この論文を中心に表示</button>
        )}
      </div>
    </>
  );
}

function EntityDetail({ kind, name, entity, isCenter, onCenterNode }) {
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
        {ENTITY_LABELS[kind] ?? kind}
      </div>
      <h3 style={{ margin: '0 0 8px' }}>{entity.name}</h3>
      {entity.aliases?.length > 1 && (
        <section>
          <h4>別名</h4>
          <p>{entity.aliases.filter((a) => a !== entity.name).join(', ')}</p>
        </section>
      )}
      <p className="detail-meta"><span>{degreeOf({ kind, key: name })} 件の論文と接続</span></p>
      {!isCenter && onCenterNode && (
        <div className="detail-actions">
          <button className="btn" onClick={() => onCenterNode({ kind, key: name })}>
            この{ENTITY_LABELS[kind] ?? kind}を中心に関係グラフを表示
          </button>
        </div>
      )}
    </>
  );
}

function EdgeDetail({ relation }) {
  const scoreVal = relation.score ?? relation.confidence;
  return (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>関係</div>
      <h3 style={{ margin: '0 0 8px' }}>{RELATION_TYPE_JA[relation.type] ?? relation.type}</h3>
      {scoreVal != null && <p className="detail-meta"><span>類似度/確信度 {scoreVal.toFixed(3)}</span></p>}
      {relation.rescued && <p className="detail-meta"><span>低接続数の救済edge</span></p>}
    </>
  );
}

export default function DetailPanel({ selection, centerKey, onClose, onCenterNode }) {
  return (
    <aside className="detail-panel" aria-label="詳細パネル">
      {!selection && <p className="detail-empty">ノードをクリックすると詳細が表示されます。</p>}
      {selection && (
        <>
          <button className="detail-close" onClick={onClose} aria-label="閉じる">×</button>
          {selection.kind === 'node' && selection.ref.kind === 'paper' && (
            <PaperDetail
              url={selection.ref.key}
              paper={selection.info}
              isCenter={nodeKey(selection.ref) === centerKey}
              onCenterNode={onCenterNode}
            />
          )}
          {selection.kind === 'node' && selection.ref.kind !== 'paper' && (
            <EntityDetail
              kind={selection.ref.kind}
              name={selection.ref.key}
              entity={selection.info}
              isCenter={nodeKey(selection.ref) === centerKey}
              onCenterNode={onCenterNode}
            />
          )}
          {selection.kind === 'edge' && <EdgeDetail relation={selection.relation} />}
        </>
      )}
    </aside>
  );
}
