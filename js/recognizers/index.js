// 認識モジュールの共通インターフェースと、ステップ1用のスタブ。
//
// recognizer = { id, label, process(frame) -> Result }
// Result.state は次の 3 つのどれか（混同しないこと）:
//   'detected'     : 検出できた
//   'not_detected' : 映像は確認できたが、検出されなかった（「存在しない」ではない）
//   'unchecked'    : 確認できていない（未実装・映像なし・処理が追いついていない など）
//
// frame = { video, width, height, timestamp, getImageData() }
//   getImageData() は必要な認識モジュールだけが呼ぶ（毎フレーム取り出さない）。
//
// ステップ2以降は、ここに車線・標識・横断歩道・歩行者の実装を差し替えて追加する。
// 重い処理は Web Worker へ移せるよう、process は frame だけを入力に取る。

export const STATES = Object.freeze({
  DETECTED: 'detected',
  NOT_DETECTED: 'not_detected',
  UNCHECKED: 'unchecked',
});

function createStub(id, label) {
  return {
    id,
    label,
    process() {
      return { state: STATES.UNCHECKED, detail: '未実装' };
    },
  };
}

export function createRecognizers() {
  return [
    createStub('lane', '車線'),
    createStub('sign', '標識'),
    createStub('crosswalk', '横断歩道'),
    createStub('pedestrian', '歩行者'),
  ];
}
