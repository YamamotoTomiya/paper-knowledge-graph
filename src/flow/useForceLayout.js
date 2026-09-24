import { useEffect, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';

const MAX_TICKS = 240; // 全体マップ(cooldownTime=3000ms)と同程度で頭打ちにする

// 関係グラフ（エゴネットワーク）に、全体マップと同じような力学シミュレーションでの
// 自然な動き（反発・リンクによる引き合い・衝突回避）を持たせる。
// buildEgoNetwork() が算出するセクター配置（種別ごとに放射状に並べた位置）を初期値として使い、
// そこから物理演算で自然に落ち着く位置へアニメーションさせる（中心ノードは原点に固定）。
export function useForceLayout(nodes, edges) {
  const [positions, setPositions] = useState({});

  useEffect(() => {
    if (!nodes.length) {
      setPositions({});
      return undefined;
    }

    const simNodes = nodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, isCenter: n.type === 'center' }));
    for (const n of simNodes) {
      if (n.isCenter) { n.fx = 0; n.fy = 0; }
    }
    const simLinks = edges.map((e) => ({ source: e.source, target: e.target }));

    const sim = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-320))
      .force('link', forceLink(simLinks).id((d) => d.id).distance(150).strength(0.55))
      .force('collide', forceCollide((d) => (d.isCenter ? 90 : 60)))
      .force('center', forceCenter(0, 0).strength(0.02))
      .alphaDecay(0.025)
      .stop();

    const applyPositions = () => {
      const next = {};
      for (const n of simNodes) next[n.id] = { x: n.x, y: n.y };
      setPositions(next);
    };
    applyPositions(); // まずセクター配置をそのまま反映し、初期表示にラグが出ないようにする

    let frame = null;
    let tickCount = 0;
    const tick = () => {
      sim.tick();
      tickCount += 1;
      applyPositions();
      if (sim.alpha() > sim.alphaMin() && tickCount < MAX_TICKS) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      sim.stop();
    };
  }, [nodes, edges]);

  return positions;
}
