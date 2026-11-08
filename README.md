# ぽちメモ（買い物メモアプリ）

夫婦で共有する買い物メモ。PWA（ホーム画面に追加して使う Web アプリ）＋ Firebase（Firestore）。
ビルド不要で、静的ファイルをそのまま公開すれば動く。

## ファイル
- `index.html` / `style.css` / `app.js` … アプリ本体
- `firebase-config.js` … Firebase の設定値（要編集）
- `firestore.rules` … Firestore のセキュリティルール（Firebase に貼る）
- `sw.js` / `manifest.webmanifest` / `icons/` … PWA（オフライン・ホーム画面）

## セットアップ手順
### 1. Firebase プロジェクトを作る
1. https://console.firebase.google.com にGoogleアカウントでログイン →「プロジェクトを追加」
2. 名前は任意（例: `pomemo`）。Google アナリティクスはオフでよい。
3. 左メニュー「構築」→「Firestore Database」→「データベースを作成」。
   ロケーションは `asia-northeast1`（東京）、モードは「本番環境モード」。
4. 「ルール」タブに `firestore.rules` の中身を貼り付けて「公開」。
5. 歯車 →「プロジェクトの設定」→「マイアプリ」→ ウェブ（`</>`）アイコンでアプリを登録。
   表示される `firebaseConfig` の値を `firebase-config.js` に貼り付ける。

### 2. 公開する（GitHub Pages）
1. GitHub に新しいリポジトリを作り、このフォルダの中身をアップロード。
2. リポジトリの Settings → Pages → Branch を `main` / root にして Save。
3. 表示された URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）がアプリの URL。

### 3. 端末に入れる
- Android（Chrome）: URL を開く → メニュー「ホーム画面に追加」（または「アプリをインストール」）。
- iPhone（Safari）: URL を開く → 共有ボタン →「ホーム画面に追加」。**Safari で開くこと**。
- 初回に共有コード（8文字以上・好きな文字列）と自分の表示（イニシャル/絵文字）を入力。
  2人目は同じ共有コードを入力すると同じリストにつながる。

## 動作メモ
- 共有コードは SHA-256 でハッシュ化したものを Firestore のパスに使う（コード自体は保存しない）。
- 同時に操作が重なった場合は、後から同期された方が優先（あと勝ち）。
- 更新を公開した後は、アプリを 2 回開き直すと新しい版になる（起動を速くするため、キャッシュを先に表示する作り）。
  キャッシュを強制更新したいときは `sw.js` の `CACHE` 名（`pomemo-v1`）を上げる。
- 通知機能はなし。

## データ構造（Firestore）
`lists/{ハッシュ化した共有コード}/` 配下に
- `stores/{id}` … `name`, `order`
- `categories/{id}` … `storeId`, `name`, `order`
- `items/{id}` … `name`, `storeId`, `categoryId`, `need`, `qty`, `by`, `temp`, `createdAt`
