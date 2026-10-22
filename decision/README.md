# dsh-decision

DSH (DeepSeek Harness) の Host プラグイン。ローカルの **Jev / d1（System One）** に、型付きの判断を 1 問ずつ問い合わせる `decide` ツールを足す。

モデルは文章を生成せず、選んだ選択肢と確率だけを受け取る。ルーティング・トリアージ・yes/no の判定に向く。

## 前提

`POST /v1/systemone` を喋るサーバが 1 つ以上動いていること。

- [OpenJev](https://github.com/...) の `openjev-serve`（Jev 互換、既定 `127.0.0.1:8788`）
- d1 の llama.cpp フォーク（`server-decision.cpp`、既定 `127.0.0.1:8081`）

どちらも同じリクエスト／レスポンス形式:

```json
{ "state": "状況", "questions": { "q": { "type": "noul", "instructions": "判断したいこと" } } }
{ "model": "...", "answers": { "q": { "noul": 0.87 } } }
```

## 設定

設定画面（プラグイン設定）で編集する。

| キー | 既定 | 意味 |
|---|---|---|
| `endpoints` | `d1` → `http://127.0.0.1:8081/v1/systemone`、`jev` → `http://127.0.0.1:8788/v1/systemone` | 名前と URL の組 |
| `defaultEndpoint` | `d1` | `endpoint` 省略時に使う名前 |
| `timeoutMs` | `30000` | 1 リクエストの予算 |

```yaml
- id: decision
  name: dsh-decision
  config:
    endpoints:
      - name: d1
        url: http://127.0.0.1:8081/v1/systemone
      - name: jev
        url: http://127.0.0.1:8788/v1/systemone
    defaultEndpoint: d1
```

## ツール

```
decide(
  situation: string,       // 判断に必要な事実を 1 行 1 件で
  question: string,        // 判断したいこと
  options?: string[],      // 省略すると yes/no（noul）
  endpoint?: string,       // 設定した名前
)
```

返り値:

- `options` なし: `P(yes) = 0.870`
- `options` あり: 選ばれた選択肢と、全選択肢の確率（降順表示）

```
d1 (stub-decision)
choice: billing (confidence 0.60)
  billing: 0.700
  access: 0.150
  other: 0.150
```

## 制限

1. 1 回 1 問。複数量子問は呼び出しを分ける
2. `noul` と `choice` のみ（`score` は未対応）
3. 認証ヘッダは送らない。手元のループバックサーバ前提
4. 到達できない場合と異常応答は、そのままツールのエラーになる

## テスト

```sh
npm test
```

`fetch` を差し替えて、リクエスト本文・正規化・エラー経路を検証する。実サーバは不要。
