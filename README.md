# Offload

会話の続きから実行Planを作り、**準備済みのCloudへ渡す** Agent Skill です。Pi・OpenCode・Codex・Claude Code・Cursorの今の会話とモデルを使い、送り先だけを切り替えます。

```text
相談・調査・途中までの実装
  → /offload cursor
  → 最新の決定事項・残作業・受入条件をPlan化
  → 環境の準備／再利用
  → 正しいコードのスナップショットを送信
  → Cloudの受付情報を元の会話へ
```

**0.1.2 / experimental** — 実行コードと自動テストを含みます。実アカウントのCloud作成・課金を伴うE2Eは未検証です。スキルをインストールしても、各社の認証やCloud権限が自動で付くわけではありません。

## skills.shからインストール

```sh
npx skills add moto-taka/offload --skill offload
```

利用ツールを指定する場合：

```sh
npx skills add moto-taka/offload --skill offload -g -a pi -a opencode -a claude-code -a codex -a cursor
```

`skills/offload/`にCLI・スキーマ・資料まで同梱しています。**別リポジトリのclone、npmへのパッケージ公開、ランタイム依存のnpm installは不要**です。必要なのはNode.js **26.x（`>=26.0.0 <27.0.0`）**、Git、および各社の正規ログイン／APIアクセスです。`.nvmrc`・`.node-version`とCIも26系に統一しています。

skills.shの一覧への掲載時期・検索順位は、このリポジトリでは保証しません。GitHubソース指定で導入できます。CIには実際の`skills` CLIでコピーして動かす試験を含めています。

### Node.js 26の準備

```bash
nvm install 26
nvm use 26
node --version
```

2026年10月9日時点ではNode.js 26はCurrentで、公式スケジュール上のLTS移行予定日は2026年10月28日です。`lts/*`ではなく26系を明示しているため、LTS移行後も同じ設定を使えます。

- [Node.js公式リリーススケジュール](https://github.com/nodejs/Release/blob/main/schedule.json)

## 使い方

```text
/offload
/offload codex
/offload claude
/offload cursor テストと結果報告まで
/offload devin
/offload --preview
/offload status <job-id>
/offload resume <job-id>
```

Codexでは配布版により`$offload`または`/skills`から呼び出します。Piのスキル呼び出しは`/skill:offload`です。Pi／OpenCodeに`/offload`を追加する場合は、インストールされたSKILL.mdと同じディレクトリ内のスクリプトを使います。

```sh
node "<installed-skill>/scripts/offload.mjs" install-host pi --scope global
node "<installed-skill>/scripts/offload.mjs" install-host opencode --scope global
```

明示的に実行したときだけ小さなローダーを配置します。既存コマンドがあれば上書きせず止まります。ホストを再読み込みしてください。

引数なしはCodex→Codex、Claude→Claude、Cursor→Cursor。Pi／OpenCodeはユーザー設定の既定Cloudを使います。使用モデル名から送り先は推測しません。

## 最初の設定

```sh
node "<installed-skill>/scripts/offload.mjs" setup cursor --repo "/absolute/project"
```

本人のターミナルで、対象アカウント、実験的Adapterの有効化、引き継ぎ専用refへのpush、環境作成などを確認します。エージェントの非対話実行では**無効な設定ひな形を保存するだけ**です。秘密値は設定やチャットに貼らず、指定した環境変数／各社公式ログインで管理します。

通常はスキルがPlanを作成してsubmitまで進みます。初回承認で止まったら、本人のターミナルで：

```sh
node "<installed-skill>/scripts/offload.mjs" trust "ofl_<job-id>"
node "<installed-skill>/scripts/offload.mjs" resume "ofl_<job-id>"
```

承認対象はPlan・レシピ・全ファイル・アカウント・権限の組合せです。ユーザーが明示的に設定した限定ポリシーなら、承認済みレシピの通常作業を自動送信できます。新しいuntrackedファイルは自動承認しません。

詳しくは [setup](skills/offload/references/setup.md) を参照してください。

## Cloudごとの実装

| 送り先 | 実装した経路 | 実行時に必要な条件／制限 |
|---|---|---|
| **新Codex Cloud** | ChatGPT設定画面から**Cloud Environment Onboarding: Setup**を実行。結果とタスク送信は`ui-begin`／`ui-record`で記録 | 未認証ならログインを依頼し、同じjobを再開。環境の作成・設定・PublishをOffload側で個別操作しません。接続済みホストが必要で、CLIやLegacyへの切替はありません |
| **Claude Code Cloud** | 正規CLIで認証確認・管理Cloudへの投入 | CLI 2.1.224以降、claude.ai OAuth、管理Cloudの確認。独立したdepth-1 snapshot checkoutから送信。進捗は公式UIで確認する場合があります |
| **Cursor Cloud** | API v1の個人環境作成／所有環境更新・Build確認・Agent/Run送信と状態取得 | ユーザーAPIキー。名前付き環境を明示し、開始時に指定commitを検証する方式への承認が必要。`env`と`repos`は混在させません |
| **Devin** | v3beta1 Blueprint作成＋明示Build、v3 Session送信・状態取得 | 環境管理権限と組織Snapshotの影響範囲の承認。既存／外部変更された共有Blueprintの上書き・自動採用は行わず確認で停止 |

新Codexの環境準備では、`https://chatgpt.com/settings/codex-cloud`から、次の指示だけを実行します（URLは対象repoに置き換えます）。

```text
Cloud Environment Onboarding: Setup を使って、https://github.com/<owner>/<repo> のクラウド環境をセットアップしてください。未認証の場合は、ログインを求めてください。
```

Setup完了後に保存済みのWorkPlanをCloudへ送ります。Setupの名前・実行方法はユーザー指定の運用で、Offloadの公式CLIコマンドではありません。この更新では実アカウントでのSetup実行は未検証です。

ここでいう実装はローカル・モックの契約試験済みコードです。**4社の本番API／CLI／UIでの接続成功を確認したという意味ではありません。** beta API、CLIのJSON、UIに差異があれば処理を止めます。

環境構築の成功とテスト成功、タスク受付と作業完了は別々に扱います。特に名前付きCursor環境とCodex UIでは、Gitの開始点を指示で検証する方式であり、ネイティブAPIによる書込権限制御の代わりにはなりません。

## 実装済みの安全策

- Planのスキーマ・根拠参照・循環依存・未対応要件・秘密値候補の検査。
- SQLiteによるジョブ／環境／外部操作／承認／排他管理。送信前に意図を保存し、成否不明なPOSTやUI操作を再実行しません。
- dirty／untrackedを含む承認済みのファイルツリーを別領域でcommit。元のstaging、branch、working treeは変更しません。未push履歴は丸ごと公開せず、取得済みremoteの基点上にレビュー済みツリーをまとめます。
- 特権・資格情報・共有環境の扱いはデフォルト拒否。戻ってきたコードを自動merge・実行しません。

秘密検出はヒューリスティックで完全ではありません。送信先がpublic repoなら専用refもpublicです。**レビューの代わりにスキャナーだけを信用しないでください。** ファイル上限、未対応形式、その他の制限は[実装範囲](docs/implementation.md)に記載しています。

## 明示的に対象外

`--local`、`/offload pi`、`/handoff`別名、Tailscale／VPN、自前VM、Remote Control、Legacyへの自動退避、OpenAI Agents API／Claude Managed Agentsへの課金経路変更、自動購入・merge・本番deploy。

## 開発と検証

```sh
npm run verify
```

依存インストールなしで、構文・JSON・スキル構造検査とNode標準テストを実行します。APIは公式ドメイン向けfetchをテスト時だけ注入してモック化。Git試験はローカルbare repositoryに隔離し、課金されるCloudタスクは作りません。

ランタイムは、skills.shでディレクトリだけをコピーしてもそのまま動く**ES Modules**です。実行時ビルドと依存配布を避けるため、設計のTypeScript案をJS＋公開型定義に調整しました。

[接続仕様の出典](docs/sources.md) / [実装範囲と検証区分](docs/implementation.md) / [MIT License](LICENSE)
