# v2.0設計に対する実装範囲 — 0.1.3

## 実行コードとして含むもの

Plan/Recipeの厳格な構造検査と参照関係検査、現在ホストのPlan生成手順、Nodeプロジェクトの静的レシピ検出、明示レシピ入力、SQLite台帳、ジョブ・環境ロック、承認fingerprint、非同期外部処理の受付と再開、正確なファイルツリーの隔離Git snapshot、4社のAdapter、CodexのChatGPT Setup呼び出しと観測プロトコル、Pi拡張、OpenCodeローダー、skill配布、read-onlyのstatus。

## 検証区分

ローカルのunit/contractテスト、ローカルbare Gitを使うsnapshot試験、Core→mock環境→mock受付→mock結果の統合試験、skillディレクトリのみをコピーした実行試験を実施します。CIには公式skills CLI経由のインストール試験を含みます。

これらを、本物のCloudでの初期環境作成・タスク実行・テスト成功とは表現しません。4社の有償／認証済みE2Eはユーザー環境での確認が必要です。Devinの追加契約は不要な送り先まで妨げません。

## 意図的な制限

- 単一GitHubリポジトリ、単一PCの状態台帳。リポジトリ内で解決できるsymlinkはGit mode 120000で保持。外部・循環・欠落・秘密情報へのリンク、LFS・submodule・case衝突は停止。全体20MiB制限は撤廃し、ファイル100MiB・100,000ファイルをOffloadの安全上限とします。全社のCloud容量上限を保証する値ではありません。
- dirty/untrackedを失わず、全ツリーを承認対象にします。検査を通すために勝手にcleanなdevelop/mainへ切り替えません。新しいuntrackedを自動許可せず、除外設定はまだありません。Planは検査前にsave-planで保存します。
- 作業ツリーは保持し、未pushコミット履歴はflattenします。元の履歴やステージ区分をCloudへ完全移植する機能ではありません。
- 秘密が必要な環境は停止します。Secretを自動登録・uploadする実装はありません。既存組織の全Secretを列挙／取得もしません。
- 自動レシピ検出はNodeの単一ロックファイル構成。他言語・モノレポは明示レシピを現在エージェントが作ります。
- Cursorのnamed envを優先。startingRefと同時指定できないため、承認済みの実行前Gitゲートを使います。API応答から正しいactive imageを断定せず、Build成功はLAUNCHABLEとして実行先に再確認させます。
- Devinの既存共有Blueprintの自動上書き・採用、snapshot pin/cancel、組織内の他案件変更は行いません。既存環境の新しい構成を適用するには手動レビューが必要です。
- Codexの環境準備は`https://chatgpt.com/settings/codex-cloud`の`Cloud Environment Onboarding: Setup`へ委譲します。OffloadでCreate/Install/Publishを再実装せず、未認証ならログインを求め、保存済みjobを再開します。実アカウントでのSetup実行は未検証です。
- CodexのGUIエンジンは内蔵しません。現在ホストの正規ブラウザ操作能力を利用するスキルです。観測JSONの形と一致はCoreが検査しますが、本当に画面を見たことの証明はホスト側のツール履歴に依存します。
- UIやAPIの成否不明を「未作成」として再実行しません。安全に自動照合できない場合は停止。リモート操作の完全exactly-once保証は主張しません。
- 状態取得は単発。常駐監視、通知、ホスト終了後のpoll、期限による自動削除はありません。Runtime stateはOS別ユーザー領域です。
- 受信先の結果はUNVERIFIEDのまま返します。証拠を人／元ホストが確認する前にVERIFIEDへ自動昇格しません。
- 任意shell/HTTPを露出するMCPはありません。各ホストは制限付きCLIを呼びます。shell権限を持つホスト全体に対するセキュリティサンドボックスではありません。

## ライブ接続の受入確認

1. 本人のアカウント、契約・支出条件、対象テストrepoのアクセスを確認。
2. 初回prepareから環境作成・Build／Publish・同一jobのresumeを実行。
3. Cloudが、渡したcommitと作業範囲を実際に確認した証拠を取得。
4. 2回目は既存の適合環境を再利用することを確認。
5. 通信断後に二重タスクを作らないこと、権限失効時に別経路へ逃げないことを確認。
6. 必要なテストの実行証拠、未実行理由、成果物へのリンクを確認。

API schemaやCLIの出力が違う場合は、採用した版の公式資料と応答fixtureを更新してから対応します。未公開APIの推測で穴埋めしません。

## v0.1.3の実リポジトリ修正

[復旧と検証範囲](recovery-v0.1.3.md)を参照してください。Claudeの`--bare`を除去し、ログインを維持する個別隔離へ変更しました。Node 26の実行検査、読み取り専用認証診断、本人用`trust --remember`を追加しています。
