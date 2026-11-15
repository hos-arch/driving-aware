// 人の検出モデル（YOLOX、ONNX 形式）を、ブラウザの中で動かす（onnxruntime-web、WebAssembly）。
// 計算は別スレッド（Worker）で行い、画面や車線の処理を止めない。映像は端末の外へ送らない。

export const MODELS = {
  nano: 'models/yolox_nano.onnx', // 軽い（約 4MB）
  tiny: 'models/yolox_tiny.onnx', // やや重いが、見つけやすい（約 20MB）
};
export const MODEL_LABELS = { nano: '軽い', tiny: '見つけやすい' };

const STORAGE_KEY = 'personModel';

/** 使うモデル。URL の ?pm= があればそれ（そのとき限り）、なければ前回選んだもの、なければ nano。 */
export function personModelName() {
  try {
    const m = new URLSearchParams(location.search).get('pm');
    if (m && MODELS[m]) return m;
  } catch (_) {
    // 次へ
  }
  try {
    const m = localStorage.getItem(STORAGE_KEY);
    if (m && MODELS[m]) return m;
  } catch (_) {
    // 既定のモデルを使う
  }
  return 'nano';
}

/** 選んだモデルを覚える（次に開いたときも同じモデルで始める）。保存できなくても、開いている間は有効。 */
export function setPersonModel(name) {
  if (!MODELS[name]) return;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch (_) {
    // 保存できなくても動く
  }
}

let ortPromise = null;
function loadOrt(base) {
  if (!ortPromise) {
    ortPromise = import(new URL('vendor/ort/ort.wasm.min.mjs', base).href).then((ort) => {
      ort.env.wasm.wasmPaths = new URL('vendor/ort/', base).href;
      // 複数スレッドは、ページが crossOriginIsolated のときだけ使える（_headers で設定）
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.wasm.proxy = true;
      return ort;
    });
    ortPromise.catch(() => {
      ortPromise = null; // 読み込みに失敗したら、次の切り替えでやり直せるようにする
    });
  }
  return ortPromise;
}

export async function loadOrtDetector(name = personModelName()) {
  if (!MODELS[name]) throw new Error(`知らないモデル: ${name}`);
  const base = new URL('../../', import.meta.url);
  const ort = await loadOrt(base);
  const session = await ort.InferenceSession.create(new URL(MODELS[name], base).href, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  return {
    info: { model: name, threads: ort.env.wasm.numThreads },
    async run(input) {
      const out = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, 416, 416]) });
      return out[outputName].data;
    },
    dispose() {
      return session.release();
    },
  };
}
