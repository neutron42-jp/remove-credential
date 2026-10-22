# remove-credential

DSH (DeepSeek Harness) の Host プラグイン。ツールの結果から資格情報を消してから、モデルとセッションログに渡す。ディスク上のファイルは変更しない。

![before / after: .env on disk と、モデルが読む内容](docs/before-after.png)

`read` した `.env`:

```
1: API_KEY=deleted by plugin: remove-credential
2: DATABASE_URL=deleted by plugin: remove-credential
3: # deleted by plugin: remove-credential
```

`bash` の出力:

```
KEY=sk-removed-by-plugin
plain=ok
```

## 動作

| 経路 | 対象 | 処理 | 差し替え先 |
|---|---|---|---|
| `read` | `.env` / `.env.*` / `*.env` | 全値を削除 | `value` |
| `read` | その他のファイル | キー・PEM ブロック | `value` |
| `grep` | 一致行（ファイル単位で判定） | 同上 | `value` |
| `bash`・`web_fetch`・MCP・subagent | 結果のテキスト | キー・PEM ブロック | `content` |
| 引数が `.env` を指す任意のツール | 結果が代入行主体のとき | 全値を削除 | `content` |

`value` を差し替える経路は、本文・UI メタデータ・PTC のプログラム呼び出しがすべて伏字から再生成される。`content` を差し替える経路は、モデルが見る本文とログが伏字になる。

## `.env` の扱い

値は `deleted by plugin: remove-credential`、コメント行は `# deleted by plugin: remove-credential`、空行はそのまま。キー名と行番号は残る。

`bash` 経由（`cat .env`、`--env-file .env`、`cat config/prod.env`）も同じ。`process.env` は対象外で、`.env` という語を含むだけのログ（代入行が半分未満）も巻き込まない。

## マーカー

| 対象 | マーカー |
|---|---|
| `.env` の値・コメント | `deleted by plugin: remove-credential` |
| API キー | `<prefix>removed-by-plugin`（`sk-…` / `ghp_…` / `AKIA…`） |
| PEM 秘密鍵 | `private-key-removed-by-plugin`（BEGIN〜END の全行） |

## 検知するキー

`sk`・`oc_sk_` / GitHub（`ghp_ gho_ ghu_ ghs_ ghr_`、`github_pat_`）/ GitLab（`glpat-`、`glrt-`）/ Groq `gsk_` / xAI `xai-` / Perplexity `pplx-` / Hugging Face `hf_` / npm `npm_` / AWS（`AKIA ASIA ABIA ACCA` + 16 桁）。

境界は「直前が英数字・`_` でない」「キーの文字種だけを食う」「最低長を満たす」「AWS は固定長 + 後続が英数字でない」。`task-runner`、`disk_total_space`、`AKIA…`+17 文字は拾わない。

## 効かない範囲

1. ツール引数（モデルが書いた `tool/call`）— registry に書き換え口がない
2. ユーザー発言・`AGENTS.md`・システムプロンプト
3. 画像などの非テキストブロック
4. 失敗したツール結果
5. `read` 以外の canonical value（PTC で読むと生のまま。native モードでは不可視）
6. PEM ブロックの途中から `offset` で読む場合
7. 未対応形式: `AIza` / Slack `xox` / SendGrid `SG.` / Shopify `shpat_` / Stripe `rk_live_` / Vault / Databricks / Notion / JWT / Telegram bot / prefix 無しの AWS シークレット

## 判定モデルの併用（任意）

設定で `judge.enabled` を入れると、正規表現が見つけた候補をローカルの Jev / d1（System One）に確認させる。4 択（資格情報 / ハッシュ / 識別子 / その他）で聞き、**確信を持って「資格情報ではない」と答えたときだけ**伏せ字を解除する。

設定は **Plugins ページ → Remove Credential → 行の Configure** で編集する（`judge.*` は volatile フィールド）。

| 設定 | 既定 | 意味 |
|---|---|---|
| `judge.enabled` | `false` | オフなら正規表現のみ（決定論的・サーバ不要） |
| `judge.endpoint` | `http://127.0.0.1:8081/v1/systemone` | d1 / jev のエンドポイント |
| `judge.timeoutMs` | `3000` | 1 候補あたりの予算 |

解除の条件は非対称:

```
P(資格情報) < 0.05 かつ max(P(ハッシュ), P(識別子), P(その他)) >= 0.8
```

- 迷ったら伏せる。ネットワーク失敗・異常応答・タイムアウトも伏せる
- 判定モデルは候補を**追加できない**。正規表現が見つけたものを裁定するだけ
- 実測: `sha256=sk_HDVL…`（正規表現の誤検知）は hash 0.97 で解除、`xai-…` の本物の鍵は 0.07 で条件に届かず伏せたまま
- 1 候補 = 1 リクエスト（d1-3B で約 40ms）。候補が多いファイルは遅くなる

## インストール

```sh
git clone https://github.com/neutron42-jp/remove-credential
```

クローンしたディレクトリの絶対パスを `plugin_manager` に渡す:

```
plugin_manager install_bundle target=<clone したディレクトリの絶対パス>
```

`package.json` の `dsh.bundle.patch` が `cordis.patch.yml` を指し、`remove-credential` の行を 1 本 insert する。プロファイル全体に効き、再起動後も残る。

## テスト

```sh
npm test                      # 43 テスト
node scripts/scan.mjs ~/dev   # 誤検知スキャン（一致した値は出力しない）
```

テストは純粋関数とリスナー配線だけを検証する。`.env` ファイルは 1 つも作らない・読まない（フィクスチャはインライン文字列）。

## 構成

| ファイル | 役割 |
|---|---|
| `index.js` | リスナー登録とプロンプトセクション |
| `lib/redact.js` | 検出・置換ロジック |
| `lib/judge.js` | 判定モデルへの問い合わせ（任意） |
| `cordis.patch.yml` | バンドルのパッチ（insert 1 行） |
| `scripts/scan.mjs` | 誤検知スキャン |
| `test/` | コーパスとユニットテスト |
| `locale/{en,ja}.json` | プラグイン一覧の表示名と説明 |
| `icon.svg` | アイコン |
| `docs/before-after.png` | README の図（生成: `docs/diagram.py`） |

## License

MIT
