// 速度の変換・表示と GPS 状態の判定（DOM に依存しない純粋関数）

export const GPS_STALE_MS = 5000;

/** m/s → km/h。取得できていない値は 0 にせず null を返す。 */
export function msToKmh(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  return ms * 3.6;
}

/** 表示用の文字列。取得できていないときは "--"。 */
export function formatSpeed(kmh) {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return '--';
  return String(Math.round(kmh));
}

/** 表示している速度が制限を超えたか。どちらかが不明なら判定しない。 */
export function isOverspeed(speedKmh, limitKmh) {
  if (speedKmh == null || limitKmh == null) return false;
  return Math.round(speedKmh) > limitKmh;
}

/**
 * GPS の状態を判定する。
 * kind: waiting | ok | no-speed | stale | denied | unavailable
 * error は呼び出し側が、受信に成功したら null に戻す。
 */
export function describeGps({ error, lastUpdateAt, speedMs, accuracyM, now, staleMs = GPS_STALE_MS }) {
  if (error) {
    if (error.code === 1) {
      return { kind: 'denied', text: '位置情報が許可されていません' };
    }
    return { kind: 'unavailable', text: '位置情報を取得できません' };
  }
  if (lastUpdateAt == null) {
    return { kind: 'waiting', text: 'GPS 受信待ち' };
  }
  if (now - lastUpdateAt > staleMs) {
    return { kind: 'stale', text: 'GPS 更新なし' };
  }
  if (speedMs === null || speedMs === undefined || !Number.isFinite(speedMs)) {
    return { kind: 'no-speed', text: '速度を取得できていません' };
  }
  const acc = Number.isFinite(accuracyM) ? ` ±${Math.round(accuracyM)}m` : '';
  return { kind: 'ok', text: `GPS 受信中${acc}` };
}
