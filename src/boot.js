// 地図の描画には WebGL2 が必要(maplibre-gl 6 から WebGL1 では動かない)。
// 使えない環境(ブラウザの GPU 無効化など)では、何も映らないまま例外だけが出ないよう、原因と対処を画面に出す。

function hasWebGL2() {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function showWebGLError() {
  document.getElementById('status').hidden = true;
  document.getElementById('no-webgl').hidden = false;
}

if (!hasWebGL2()) {
  showWebGLError();
} else {
  // 事前チェックを通っても MapLibre の初期化で失敗することがあるので、読み込み時の例外も拾う
  // (WebGL2 のコンテキストを作れないと、Map のコンストラクタが GPUInitializationError を投げる)
  import('./main.js').catch((err) => {
    console.error(err);
    if (err?.name === 'GPUInitializationError' || /WebGL/i.test(String(err?.message))) showWebGLError();
    else throw err;
  });
}
