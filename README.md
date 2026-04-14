# Paper Workbench

一个面向 Codex 的论文工作台：

- 网页只负责展示、查看、管理
- AI 负责生成摘要、翻译、笔记和条目补全
- 你只需要丢 PDF、DOI 或关键词，再调用 `paper-workbench`

## 仓库内容

- `paper-reader-ai-branch/`：网页 + 本地服务 + 空白工作台
- `skill/paper-workbench/SKILL.md`：可安装到 Codex 的复用 skill
- `install-skill.sh`：安装 skill
- `start-paper-workbench.sh`：启动工作台

## 适用场景

适合希望用 **AI 生成论文摘要 / 翻译 / 笔记**，而把网页仅作为 **展示、查看和管理界面** 的人。

## 快速开始

### 1. 安装 skill

在终端里进入这个目录，执行：

```bash
sh install-skill.sh
```

安装后，对方在任何新对话都可以直接说：

- `用 paper-workbench 处理这个 PDF`
- `用 paper-workbench 根据关键词建条目`
- `用 paper-workbench 生成这篇论文的摘要、翻译和笔记`

### 2. 启动网页

执行：

```bash
sh start-paper-workbench.sh
```

默认地址：

- `http://127.0.0.1:8877/web/`

### 3. 使用方式

#### 网页里做的事

- 上传 PDF
- 创建论文草稿
- 查看论文卡片
- 管理 AI 状态 / 阅读状态
- 查看汇总表

#### AI 做的事

- 根据 PDF / DOI / 关键词创建条目
- 生成中文摘要
- 生成关键信息
- 生成中文翻译
- 生成阅读笔记
- 回填工作台文件

## 目录结构

- `paper-reader-ai-branch/data/papers.json`：论文主数据
- `paper-reader-ai-branch/summaries/papers-overview.csv`：汇总表
- `paper-reader-ai-branch/papers/`：论文原文、翻译、笔记

## 分享建议

- 这个仓库默认是 starter 状态，不带你的私人论文数据
- 如果要长期协作，建议把 skill 和工作台一起维护在同一个仓库里
