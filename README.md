# Tour on Map

巡業の日程表(日時・会場)から、会場を日時順に並べ、会場から会場への車の経路(陸路)を地図に表示する静的サイトです。
GitHub Pages だけで動きます。日程は、画面の「日程を変える」に貼り付けて、その場で作り直せます。

公開URL: https://gosyujin.com/tour-on-map/

- 地図: [MapLibre GL JS](https://maplibre.org/) + [OpenStreetMap](https://www.openstreetmap.org/) 標準タイル
- 経路: [OSRM](https://project-osrm.org/) の公開サーバーで計算。最初に出る日程は、事前に計算して `public/data/tour.json` としてコミット
- 次の公演まで日が空く区間は破線にし、経路の上に「中N日」と表示(翌日に公演のある区間は実線)
- 各区間・全経路を Google マップで開くリンク付き
- ビルド: Vite / デプロイ: GitHub Actions → GitHub Pages

## 開発

```bash
npm install
npm run dev      # http://localhost:5173/tour-on-map/
npm run build
npm test         # 日程表の読み取りと、経路データへの変換のテスト
```

## 日程を差し替える

自分のブラウザで見るだけなら、画面でできます。結果はそのブラウザにだけ保存されます。

1. 画面の「日程を変える」に、公式サイトの日程表を貼り付ける
2. 初めての会場は、会場名から住所が自動で入る。見つからなかった会場だけ、住所を入れる
3. 「経路を計算して表示」を押す

全員に見える最初の日程を変えるときは、リポジトリのファイルを直します。

1. `tours/tour.txt` に、公式サイトの日程表を貼り付ける
2. 新しい会場があれば、`data/venues.json` に住所を足す
3. `npm run build-tour` で `public/data/tour.json` を作り直し、コミットする

詳しくは [docs/data.md](docs/data.md)。

## データの出典

- 背景地図・経路 © OpenStreetMap contributors (ODbL)。標準タイルサーバーを使っているので、アクセスが増える場合は[タイル利用ポリシー](https://operations.osmfoundation.org/policies/tiles/)に従って切り替えを検討してください。
- 住所から座標への変換: 国土地理院の住所検索
- 会場名からの住所・位置の検索: Wikipedia、OpenStreetMap(Nominatim)、国土地理院
