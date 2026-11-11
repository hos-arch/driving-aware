// 認識モジュールの共通インターフェースと、ステップ1用のスタブ。
//
// recognizer = { id, label, process(frame) -> Result }
// Result.state は states.js の 3 つのどれか（混同しないこと）。
//
// frame = { video, width, height, timestamp, getImageData() }
//   getImageData() は必要な認識モジュールだけが呼ぶ（毎フレーム取り出さない）。
//
// 車線は実装済み。標識の認識は外した（色と形だけでは看板と区別できなかったため。コードは git の履歴に残る）。
// 次は歩行者（人の検出）を最優先で実装する。横断歩道・歩行者は今は未実装のスタブ。
// 重い処理は Web Worker へ移せるよう、process は frame だけを入力に取る。

import { STATES } from './states.js';
import { createLaneRecognizer } from './lane.js';

export { STATES };

function createStub(id, label) {
  return {
    id,
    label,
    process() {
      return { state: STATES.UNCHECKED, detail: '未実装' };
    },
  };
}

export function createRecognizers(config = {}) {
  return [
    createLaneRecognizer(config.lane),
    createStub('crosswalk', '横断歩道'),
    createStub('pedestrian', '歩行者'),
  ];
}
