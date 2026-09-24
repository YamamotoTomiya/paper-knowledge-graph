import React, { useMemo } from 'react';
import {
  CATEGORIES, CATEGORY_TEXT_COLORS, META, PAPER_GLOBAL_GRAPH, RELATION_TYPE_COLOR, RELATION_TYPE_JA,
  SLACK_STATUS_JA, STATS, TOPICS,
} from '../data/graph.js';

const SLACK_STATUS_COLOR = { posted: '#166534', not_attempted: '#94a3b8', webhook_not_set: '#9a3412' };

// 汎用の横棒グラフ。items=[key, value]の配列（呼び出し側で並び順を決める）。
function BarList({ items, colorOf, labelOf, max }) {
  const maxVal = max ?? Math.max(...items.map(([, v]) => v), 1);
  return (
    <div className="bar-list">
      {items.map(([key, value]) => (
        <div className="bar-row" key={key}>
          <span className="bar-label">{labelOf ? labelOf(key) : key}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.min(100, (value / maxVal) * 100)}%`, background: colorOf ? colorOf(key) : '#475569' }} />
          </div>
          <span className="bar-value">{value.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsView({ onOpenPaper }) {
  const topTopics = useMemo(
    () => Object.entries(STATS.byTopic).sort((a, b) => b[1] - a[1]).slice(0, 15),
    [],
  );
  // 類似論文数（SIMILAR_TO）が多い、いわゆるハブ論文のランキング（JP_Market_Vis の
  // 「ハブ企業ランキング」と同じ考え方）。クリックでその論文を中心に局所マップを開く。
  const hubPapers = useMemo(
    () => [...PAPER_GLOBAL_GRAPH.nodes].sort((a, b) => b.degree - a.degree).slice(0, 20),
    [],
  );
  const relationTypeItems = useMemo(
    () => Object.entries(STATS.byRelationType).sort((a, b) => b[1] - a[1]),
    [],
  );
  // スコア分布はヒストグラムなので件数順ではなくスコア1〜10の順に並べる
  const scoreItems = useMemo(
    () => Array.from({ length: 10 }, (_, i) => i + 1).map((s) => [String(s), STATS.byScore[s] ?? 0]),
    [],
  );
  // 週次推移も件数順ではなく時系列順に並べる
  const weekItems = useMemo(
    () => Object.entries(STATS.byWeek).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    [],
  );
  const sourceItems = useMemo(
    () => Object.entries(STATS.bySource).sort((a, b) => b[1] - a[1]).slice(0, 15),
    [],
  );
  const avgScoreByCategoryItems = useMemo(
    () => Object.entries(STATS.avgScoreByCategory).sort((a, b) => b[1] - a[1]),
    [],
  );
  const slackStatusItems = useMemo(
    () => Object.entries(STATS.bySlackStatus).sort((a, b) => b[1] - a[1]),
    [],
  );

  return (
    <div className="stats-view">
      <section className="stats-summary">
        <div><strong>{STATS.papers.toLocaleString()}</strong><span>論文</span></div>
        <div><strong>{STATS.topics.toLocaleString()}</strong><span>トピック</span></div>
        <div><strong>{STATS.concepts.toLocaleString()}</strong><span>コンセプト</span></div>
        <div><strong>{STATS.methods.toLocaleString()}</strong><span>手法</span></div>
        <div><strong>{STATS.representations.toLocaleString()}</strong><span>表現形式</span></div>
        <div><strong>{STATS.relations.toLocaleString()}</strong><span>関係</span></div>
        <div><strong>{STATS.avgScore.toFixed(1)}</strong><span>平均スコア</span></div>
        <div><strong>{(STATS.extractionCoverage * 100).toFixed(0)}%</strong><span>Concept等抽出済み</span></div>
      </section>

      <div className="stats-grid">
        <section className="stats-block">
          <h3>カテゴリ別件数</h3>
          <BarList
            items={Object.entries(CATEGORIES).map(([key, label]) => [label, STATS.byCategory[key] ?? 0])}
            colorOf={(label) => CATEGORY_TEXT_COLORS[Object.keys(CATEGORIES).find((k) => CATEGORIES[k] === label)] ?? '#475569'}
            max={STATS.papers}
          />
        </section>

        <section className="stats-block">
          <h3>カテゴリ別平均スコア</h3>
          <BarList
            items={avgScoreByCategoryItems.map(([key, v]) => [CATEGORIES[key] ?? key, v])}
            colorOf={(label) => CATEGORY_TEXT_COLORS[Object.keys(CATEGORIES).find((k) => CATEGORIES[k] === label)] ?? '#475569'}
            max={10}
          />
        </section>

        <section className="stats-block">
          <h3>関係タイプ別件数</h3>
          <BarList
            items={relationTypeItems.map(([key, v]) => [RELATION_TYPE_JA[key] ?? key, v])}
            colorOf={(label) => RELATION_TYPE_COLOR[Object.keys(RELATION_TYPE_JA).find((k) => RELATION_TYPE_JA[k] === label)] ?? '#475569'}
          />
        </section>

        <section className="stats-block">
          <h3>スコア分布（1〜10）</h3>
          <BarList items={scoreItems} colorOf={() => '#0369a1'} />
        </section>

        <section className="stats-block">
          <h3>週次収集件数の推移</h3>
          <BarList items={weekItems} colorOf={() => '#166534'} />
        </section>

        <section className="stats-block">
          <h3>Slack共有状況</h3>
          <BarList
            items={slackStatusItems.map(([key, v]) => [SLACK_STATUS_JA[key] ?? key, v])}
            colorOf={(label) => SLACK_STATUS_COLOR[Object.keys(SLACK_STATUS_JA).find((k) => SLACK_STATUS_JA[k] === label)] ?? '#475569'}
            max={STATS.papers}
          />
        </section>

        <section className="stats-block stats-block-wide">
          <h3>情報源別件数 トップ15</h3>
          <BarList items={sourceItems} colorOf={() => '#7b85c6'} />
        </section>

        <section className="stats-block stats-block-wide">
          <h3>論文数の多いトピック トップ15</h3>
          <BarList
            items={topTopics.map(([topicId, count]) => [TOPICS[topicId]?.label ?? topicId, count])}
            colorOf={() => '#475569'}
          />
        </section>
      </div>

      <section className="stats-block stats-block-wide">
        <h3>ハブ論文ランキング（類似論文数 上位20件）</h3>
        <table className="data-table">
          <thead>
            <tr>
              {['#', 'タイトル', 'カテゴリ', 'score', '類似論文数'].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {hubPapers.map((p, i) => (
              <tr key={p.id} tabIndex={0} className="clickable-row"
                onClick={() => onOpenPaper?.(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenPaper?.(p.id); }}
              >
                <td>{i + 1}</td>
                <td className="hub-title">{p.title}</td>
                <td style={{ color: CATEGORY_TEXT_COLORS[p.category] }}>{CATEGORIES[p.category] ?? p.category}</td>
                <td>{p.score}</td>
                <td>{p.degree}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="stats-footnote">データ生成 {META.generatedAt?.slice(0, 19).replace('T', ' ')} UTC</p>
    </div>
  );
}
