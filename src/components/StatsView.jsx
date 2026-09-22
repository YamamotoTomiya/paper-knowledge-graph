import React, { useMemo } from 'react';
import { CATEGORIES, CATEGORY_TEXT_COLORS, META, STATS, TOPICS } from '../data/graph.js';

export default function StatsView() {
  const topTopics = useMemo(
    () => Object.entries(STATS.byTopic).sort((a, b) => b[1] - a[1]).slice(0, 15),
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
      </section>

      <section className="stats-block">
        <h3>カテゴリ別件数</h3>
        <div className="bar-list">
          {Object.entries(CATEGORIES).map(([key, label]) => {
            const count = STATS.byCategory[key] ?? 0;
            const pct = STATS.papers ? (count / STATS.papers) * 100 : 0;
            return (
              <div className="bar-row" key={key}>
                <span className="bar-label">{label}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${pct}%`, background: CATEGORY_TEXT_COLORS[key] }} />
                </div>
                <span className="bar-value">{count.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="stats-block">
        <h3>論文数の多いトピック トップ15</h3>
        <div className="bar-list">
          {topTopics.map(([topicId, count]) => (
            <div className="bar-row" key={topicId}>
              <span className="bar-label">{TOPICS[topicId]?.label ?? topicId}</span>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${(count / topTopics[0][1]) * 100}%`, background: '#475569' }} />
              </div>
              <span className="bar-value">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <p className="stats-footnote">データ生成 {META.generatedAt?.slice(0, 19).replace('T', ' ')} UTC</p>
    </div>
  );
}
