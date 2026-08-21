# Failure Log (docs/failures.md)

> **運用ルール**
> - 本ファイルは **Append-Only (追記専用)** です。
> - 過去に記録された失敗事例を削除・上書きしてはいけません。
> - 新たな失敗・トラブルが発生し解決した際、末尾に追記してください。
> - Main Agentはセッション開始時に本ファイルを全文読み込みません。`failure-matcher` が必要時のみ検索・照合します。

---

## 記録フォーマット (Template)

```markdown
### [F-YYYYMMDD-NN] 失敗のタイトル / サマリー

- **Date**: YYYY-MM-DD
- **Category**: (setup / git / ci / auth / db / api / test / deployment / security / logic / etc.)
- **Trigger/Context**: (発生時の状況・触っていたファイルやコマンド)
- **Failure**: (何が起きたか・エラー内容・症状)
- **Root Cause**: (根本原因)
- **Guardrail / Prevention**: (今後同種の作業を行う際に確認すべき1つのチェックポイント)
```

---

## 過去の失敗記録一覧 (Failure Records)

<!-- 失敗事例が発生した場合は、ここに追記してください -->
