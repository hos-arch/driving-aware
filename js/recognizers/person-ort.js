// 人の検出モデル（YOLOX、ONNX 形式）を、ブラウザの中で動かす（onnxruntime-web、WebAssembly）。
// 計算は別スレッド（Worker）で行い、画面や車線の処理を止めない。映像は端末の外へ送らない。

const MODELS = {
  nano: 'models/yolox_nano.onnx', // 軽い（約 4MB）
  tiny: 'models/yolox_tiny.onnx', // やや重いが、見つけやすい（約 20MB）
};

export function personModelName() {
  try {
    const m = new URLSearchParams(location.search).get('pm');
    if (m && MODELS[m]) return m;
  } catch (_) {
    // 既定のモデルを使う
  }
  return 'nano';
}

export async function loadOrtDetector(name = personModelName()) {
  const base = new URL('../../', import.meta.url);
  const ort = await import(new URL('vendor/ort/ort.wasm.min.mjs', base).href);
  ort.env.wasm.wasmPaths = new URL('vendor/ort/', base).href;
  // 複数スレッドは、ページが crossOriginIsolated のときだけ使える（_headers で設定）
  const threads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.proxy = true;
  const session = await ort.InferenceSession.create(new URL(MODELS[name], base).href, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  return {
    info: { model: name, threads },
    async run(input) {
      const out = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, 416, 416]) });
      return out[outputName].data;
    },
  };
}
