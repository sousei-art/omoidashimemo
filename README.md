# 思い出しメモ v2.0.0

Supabaseを正データとして、PC・iPad・iPhoneで同じ小ネタ／持ち物／画像を共有するクラウド版です。

## v2.0.0の主な変更

- React 19 + Vite 7へ移行
- Supabase Auth（メール＋パスワード）
- Supabase Database（notes / items / image_files）
- Supabase Storage（Private Bucket: memo-images）
- RLSでログインユーザー本人のデータだけ許可
- 小ネタ・持ち物のCRUD
- 小ネタ・持ち物の画像保存
- タグ検索・全文検索
- 持ち物の購入日順並べ替え
- 所持状況6種類
- JSONバックアップ
- v1.x JSONの移行
- JSONの追加復元 / 差分復元 / 全消去復元

## 所持状況

- 所持中（使用中）
- 所持中（未使用）
- 所持中（使用終わり）
- 故障
- 紛失・廃棄
- 売却済み

旧データの「所持中」は移行時に「所持中（使用中）」へ変換します。

---

# 1. Supabase側の設定

## 1-1. 新しいSupabase Projectを作成

Supabase Dashboardで新しいProjectを作成します。

## 1-2. SQLを実行

Supabase Dashboard → **SQL Editor** → **New query** を開き、

`supabase/setup.sql`

の中身をすべて貼り付けて実行してください。

このSQLで以下を作成します。

- `notes`
- `items`
- `image_files`
- RLS Policy
- `memo-images` Private Storage Bucket
- Storage Policy
- updated_at自動更新Trigger

## 1-3. Authenticationの確認

Supabase Dashboard → **Authentication** でEmail認証を使用します。

初回アカウント作成時に確認メールを使いたくない場合は、AuthenticationのEmail設定で確認メールの要否を調整してください。

※会社・個人の運用ルールに合わせて設定してください。

---

# 2. ローカルで起動する

Node.jsが入ったPCで、このフォルダを開きます。

```bash
npm install
```

`.env.example` をコピーして `.env.local` を作成します。

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Supabase DashboardのProject Settings / API Keys付近から、Project URLとPublishable keyを確認して設定します。

**フロント側にservice_role keyやsecret keyは絶対に入れないでください。**

起動：

```bash
npm run dev
```

ビルド確認：

```bash
npm run build
```

---

# 3. Vercel公開

GitHubへこのプロジェクトをアップロードし、VercelからImportします。

VercelのProject Settings → Environment Variablesに以下を登録します。

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Framework Presetは通常Viteとして自動判定されます。

Build Command：`npm run build`

Output Directory：`dist`

Deploy後、同じURLをPC / iPad / iPhoneで開き、同じSupabaseアカウントでログインします。

---

# 4. v1.0.3からデータを移す

1. v1.0.3でJSONバックアップを書き出す
2. v2.0.0へログイン
3. 設定 → **JSONから復元 / 旧v1データを移行**
4. JSONを選択
5. 内容を確認
6. 初回移行なら「差分復元」または、v2側が空なら「全消去して復元」でも可

画像がJSON内にBase64で含まれている場合は、Supabase Storageへ画像として移行します。

---

# 5. JSON復元方式

## 追加で復元

現在のデータを残し、JSONのデータを別IDとして追加します。

同じバックアップを繰り返し追加すると重複するため注意してください。

## 差分復元

- JSONにあり、現在側にないデータ → 追加
- JSON側の更新日時が新しい → 更新
- 現在側が新しい / 同じ → スキップ
- 現在側だけにあるデータ → 残す

削除差分は自動反映しません。

## 全消去して復元

Supabase上の自分の小ネタ・持ち物・画像を削除してから、JSON内容を復元します。

---

# 6. データ保存場所

## Database

- `notes`：小ネタ
- `items`：持ち物
- `image_files`：画像とデータの関連付け

## Storage

Private Bucket：`memo-images`

保存パス：

```text
{user_id}/notes/{note_id}/...
{user_id}/items/{item_id}/...
```

画像はPublic公開せず、ログイン済みユーザー向けのSigned URLで表示します。

---

# 7. セキュリティ方針

- DatabaseはRLS有効
- `auth.uid() = user_id` の行だけ操作可能
- StorageはPrivate
- Storageの先頭フォルダ名が自分のuser_idと一致する場合だけ操作可能
- Publishable keyのみフロントで使用
- service_role / secret keyはフロントに入れない

---

# 8. v2.0.0で未対応

- Supabase Realtimeによる即時同期
- オフライン編集
- IndexedDBとの自動二重保存
- 家族共有
- 複数ユーザー共同編集
- AI検索
- OCR
- 自動通知

別端末で変更した内容は、設定の「最新データを取得」またはページ再読み込みで取得します。

---

# 9. 動作確認チェック

## PC

- ログイン
- 小ネタ追加 / 編集 / 削除
- 持ち物追加 / 編集 / 削除
- 画像追加
- JSONバックアップ

## iPad / iPhone

- PCで作成したデータが見える
- iPad / iPhone側の変更をPCで取得できる
- 写真を追加できる
- Safariからホーム画面へ追加できる

## セキュリティ

- ログアウト後はデータ画面を表示しない
- 別ユーザーでは他ユーザーのデータが取得できない
- Private Storage画像が他ユーザーから取得できない

---

## Version

v2.0.0
