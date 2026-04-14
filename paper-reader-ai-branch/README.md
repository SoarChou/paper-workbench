# Paper Reader AI Branch

这是一个按“**AI 负责生成内容，网页只负责展示 / 查看 / 管理**”重做的简化版工作区。

## 设计原则

- 网页不再尝试自动识别论文元数据、抓 PDF、抽摘要。
- 网页只做 3 件事：
  - 创建论文草稿
  - 管理已有条目
  - 展示摘要、翻译、笔记和汇总
- 论文摘要、中文翻译、阅读笔记、关键信息等内容，由你直接让我生成并回填。

## 目录结构

- `data/papers.json`：论文元数据
- `papers/<category>/<paper-id>/original`：原文
- `papers/<category>/<paper-id>/translation`：翻译
- `papers/<category>/<paper-id>/notes`：笔记
- `summaries/papers-overview.csv`：汇总表
- `web/`：前端
- `server.py`：本地服务

## 推荐使用方式

1. 打开网页，上传 PDF，创建一个 `待AI整理` 条目。
2. 直接对我说：
   - “请为 `paper-reader-ai-branch` 里这篇论文生成中文摘要和关键信息。”
   - “请补全作者、会议、DOI，并更新工作台。”
   - “请生成中文翻译和阅读笔记。”
3. 我会更新：
   - `data/papers.json`
   - `papers/.../translation/zh-CN.md`
   - `papers/.../notes/reading-note.md`
4. 网页会自动刷新，你只负责查看和管理。

## 启动

```bash
cd /Volumes/WD_extend/workspace/codex/paper-reader-ai-branch
python3 server.py
```

默认访问地址：

- `http://127.0.0.1:8877/web/`

## 为什么这样更适合你

- 少了一堆不稳定的“自动识别”
- 错误更少，流程更可控
- 网页职责单纯，不再和 AI 生成逻辑耦合
- 你可以把“生成什么、生成到什么程度”完全交给我
