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
- `templates/`：AI 标准回填模板
- `web/`：前端
- `server.py`：本地服务

## AI 状态流

- `待整理`：草稿刚创建
- `待元数据`：作者 / 会议 / 年份 / DOI 仍待补全
- `待摘要`：待生成标准摘要、关键信息、研究重点
- `待翻译`：待生成中文翻译稿
- `待笔记`：待生成阅读笔记
- `待校对`：内容基本齐全，待校对引用和最终表述
- `已完成`：可以直接阅读与管理

网页会根据当前条目给出 `下一步` 提示，方便你直接对我下指令。

## 推荐使用方式

1. 打开网页，上传 PDF，创建一个草稿条目。
2. 直接对我说：
   - “请为 `paper-reader-ai-branch` 里这篇论文补全元数据，并更新工作台。”
   - “请按标准摘要模板生成摘要、关键信息和研究重点。”
   - “请按标准模板生成中文翻译和阅读笔记。”
3. 我会更新：
   - `data/papers.json`
   - `papers/.../translation/zh-CN.md`
   - `papers/.../notes/reading-note.md`
4. 网页会自动刷新，你只负责查看和管理。

## 启动

```bash
cd /Volumes/WD_extend/workspace/codex/paper-workbench-repo/paper-reader-ai-branch
python3 server.py
```

默认访问地址：

- `http://127.0.0.1:8877/web/`

## 为什么这样更适合你

- 少了一堆不稳定的“自动识别”
- 错误更少，流程更可控
- 网页职责单纯，不再和 AI 生成逻辑耦合
- 你可以把“生成什么、生成到什么程度”完全交给我
- AI 写回结构统一，后续更容易继续迭代
