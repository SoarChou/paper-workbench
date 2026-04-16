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

在任意电脑上，让 Codex 执行下面任一命令即可完成：下载/安装 skill/启动服务。

### GitHub 地址

```bash
tmp=$(mktemp -d) && git clone --depth 1 https://github.com/SoarChou/paper-workbench.git "$tmp/paper-workbench" && sh "$tmp/paper-workbench/codex-auto-install.sh" "$tmp/paper-workbench"
```

私有仓库可用（有权限时）：

```bash
tmp=$(mktemp -d) && git clone --depth 1 https://<TOKEN>@github.com/SoarChou/paper-workbench.git "$tmp/paper-workbench" && sh "$tmp/paper-workbench/codex-auto-install.sh" "$tmp/paper-workbench"
```

### 压缩包地址或本地 zip

```bash
tmp=$(mktemp -d) && curl -L --fail --silent --show-error "https://example.com/paper-workbench-product.zip" -o "$tmp/paper-workbench.zip" && unzip -q "$tmp/paper-workbench.zip" -d "$tmp/unzip" && installer=$(find "$tmp/unzip" -type f -name 'codex-auto-install.sh' | head -n 1) && sh "$installer" "$tmp/paper-workbench.zip"
```

```bash
cd /absolute/path/paper-workbench-product-20260416 && sh codex-auto-install.sh .
```

启动成功后访问：

- `http://127.0.0.1:8877/web/`

停止服务：

```bash
sh codex-stop.sh
```

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

## 分享建议

- 这个仓库默认是 starter 状态，不带你的私人论文数据
- 如果要长期协作，建议把 skill 和工作台一起维护在同一个仓库里
