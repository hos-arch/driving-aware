// 認識結果の 3 つの状態（混同しないこと）:
//   'detected'     : 検出できた
//   'not_detected' : 映像は確認できたが、検出されなかった（「存在しない」ではない）
//   'unchecked'    : 確認できていない（未実装・映像なし・暗い・処理が追いついていない など）
export const STATES = Object.freeze({
  DETECTED: 'detected',
  NOT_DETECTED: 'not_detected',
  UNCHECKED: 'unchecked',
});
