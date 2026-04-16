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
- `codex-auto-install.sh`：输入 zip/GitHub 地址自动安装并启动
- `codex-stop.sh`：停止后台服务

## 适用场景

适合希望用 **AI 生成论文摘要 / 翻译 / 笔记**，而把网页仅作为 **展示、查看和管理界面** 的人。

## 一键安装并启动（给 Codex 一个地址就行）

推荐只用下面两种方式，复制即用。

### 方式 A：直接给 Codex 仓库链接（推荐）

把下面这句话直接发给 Codex：

```text
请从这个仓库安装并启动 Paper Workbench：https://github.com/SoarChou/paper-workbench
```

### 方式 B：下载 Release zip 后直接拖给 Codex

先下载最新 release zip：  
`https://github.com/SoarChou/paper-workbench/releases/latest`

然后把 zip 文件拖进对话框，并发送这句话：

```text
请安装并启动这个 Paper Workbench 压缩包
```

### 终端直装（可选，不走对话拖拽）

GitHub 克隆安装：

```bash
tmp=$(mktemp -d) && git clone --depth 1 https://github.com/SoarChou/paper-workbench.git "$tmp/paper-workbench" && sh "$tmp/paper-workbench/codex-auto-install.sh" "$tmp/paper-workbench"
```

Release 直链安装：

```bash
tmp=$(mktemp -d) && curl -L --fail --silent --show-error "https://github.com/SoarChou/paper-workbench/releases/latest/download/paper-workbench-product-20260416-auto-install.zip" -o "$tmp/paper-workbench.zip" && unzip -q "$tmp/paper-workbench.zip" -d "$tmp/unzip" && installer=$(find "$tmp/unzip" -type f -name 'codex-auto-install.sh' | head -n 1) && sh "$installer" "$tmp/paper-workbench.zip"
```

### 本地解压后直接安装

```bash
cd /absolute/path/paper-workbench && sh codex-auto-install.sh .
```

启动成功后访问：

- `http://127.0.0.1:8877/web/`

停止服务：

```bash
sh ~/.paper-workbench/runtime/paper-workbench/codex-stop.sh
```

## 手动方式（可选）

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

- 查看论文卡片
- 点标题进入阅读页（原文 / 翻译 / 笔记 / 问答）
- 管理 AI 状态 / 阅读状态
- 在论文总览中筛选 / 排序 / 多选编辑 / 删除

#### AI 做的事

- 根据 PDF / DOI / 关键词创建条目并写回工作台
- 生成中文摘要
- 生成关键信息
- 生成中文翻译
- 生成阅读笔记
- 维护问答沉淀与状态推进

## 目录结构

- `paper-reader-ai-branch/data/papers.json`：论文主数据
- `paper-reader-ai-branch/summaries/papers-overview.csv`：汇总表
- `paper-reader-ai-branch/papers/`：论文原文、翻译、笔记
- `paper-reader-ai-branch/templates/`：AI 标准回填模板

## AI 状态流

- `待整理`：刚建草稿，还没进入明确阶段
- `待元数据`：作者、会议、年份、DOI / 原文链接仍缺
- `待摘要`：需要补标准摘要、关键信息、研究重点
- `待翻译`：需要补中文翻译稿
- `待笔记`：需要补结构化阅读笔记
- `待校对`：主体内容已齐，等待校对标题 / 引用 / 最终表述
- `已完成`：当前条目可直接阅读和管理

网页会展示 `下一步` 建议，方便你直接丢一句话让我继续补全。

## 标准回填模板

- `templates/summary-template.md`：标准摘要、关键信息、研究重点
- `templates/translation-template.md`：中文翻译稿结构
- `templates/notes-template.md`：阅读笔记结构

后续让 Codex 处理论文时，优先按这些模板生成并回填工作台。
