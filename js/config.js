// 設定の読み書き。端末の置き方（ROI・消失点）と、自車位置の基準を扱う。
// localStorage が使えない環境でも動くよう、すべて try/catch で包む。

function parsePair(text) {
  if (!text) return null;
  const a = text.split(',').map(Number);
  return a.length === 2 && a.every(Number.isFinite) ? a : null;
}

/**
 * 車線認識の設定。URL に ?roi=0.40,0.535&vp=0.53,0.45 を付けると上書きでき、端末に保存される。
 *   roi: 画面の高さに対する探索範囲（上端, 下端）。ダッシュボードの縁より上にする。
 *   vp : 道路の消失点（幅, 高さに対する比）。
 * 値を消したいときは ?reset=1 を付けて開く。
 */
export function loadLaneConfig() {
  const cfg = {};
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('reset')) localStorage.removeItem('laneConfig');
    const roi = parsePair(q.get('roi'));
    const vp = parsePair(q.get('vp'));
    if (roi && roi[0] >= 0 && roi[0] < roi[1] && roi[1] <= 1) cfg.roi = roi;
    if (vp && vp.every((v) => v >= 0 && v <= 1)) cfg.vp = vp;
    if (cfg.roi || cfg.vp) {
      localStorage.setItem('laneConfig', JSON.stringify(cfg));
    } else {
      const saved = JSON.parse(localStorage.getItem('laneConfig') || 'null');
      if (saved && typeof saved === 'object') {
        if (parsePair(String(saved.roi))) cfg.roi = saved.roi;
        if (parsePair(String(saved.vp))) cfg.vp = saved.vp;
      }
    }
  } catch (_) {
    // 保存できなくても、既定値で動く
  }
  return cfg;
}

/** 自車の中心が、画像の中心から何割ずれているか（幅に対する比）。未設定なら null。 */
export function getRefDx() {
  try {
    const v = localStorage.getItem('laneRefDx');
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

export function setRefDx(value) {
  try {
    localStorage.setItem('laneRefDx', String(value));
  } catch (_) {
    // 保存できなくても、このページを開いている間は有効
  }
}
