# Repository Guidelines

## 范围与结构

本指南仅适用于 `apps/console-mvp/`，这是独立静态部署的 React + Vite + TypeScript SPA，不接入 `apps/web` 的 Node 服务。`src/App.tsx` 负责页面组合与本地 mock 状态，`src/styles.css` 定义 Tailwind v4 主题和组件样式，`public/` 存放静态资源；设计约束记录在 `DESIGN.md`。视觉实现只参考 `docs/platform-overview(优化版).html`。

## 本地开发与构建

在 `apps/console-mvp/` 中执行：

- `npm run dev`：启动 Vite 开发服务器。
- `npm run build`：执行 `tsc -b` 类型检查并生成生产静态文件。
- `npm run preview`：本地预览构建结果。

提交前至少运行 `npm run build`。修改响应式布局或交互后，在桌面和移动视口手动检查页面，确认没有溢出、遮挡或布局跳变。

验证或修复期间启动的前端服务应保持运行，供后续修复后的浏览器复测复用；不要在单次检查后停止。仅在修复、复测和最终构建检查全部完成后，才停止本次任务启动的服务。

## 编码与视觉规范

使用 TypeScript、React 函数组件和 Tailwind CSS v4；组件文件用 `PascalCase.tsx`，变量、函数和事件处理器用 `camelCase`。保留现有 2 空格缩进、单引号和分号风格。避免引入组件库、内联 SVG 或手绘图标。

所有界面图标必须使用 `lucide-react`（Lucide Icons），例如 `import { Plus } from 'lucide-react'`。图标按钮需有 `aria-label` 或可见文字；不要以 Unicode 字符或 Emoji 代替功能图标。图表可使用 CSS 图形表达数据，但不得将其作为 UI 图标。

## 设计与提交

页面应与参考原型的色彩、密度、圆角、边框、间距和卡片层级一致，优先修改现有 token 与组件规则，避免新增独立视觉体系。提交使用 Conventional Commits，例如 `feat(console): add agent filters` 或 `fix(console): align project cards`。PR 说明包含变更范围、`npm run build` 结果；涉及视觉变更时附桌面与移动截图。不要提交 `dist/`、密钥或真实用户数据。

## DESIGN.md标准
DESIGN.md作为网站统一样式的标准，需要在修改样式前，允许相关DESIGN.md来检查文件，并导出样式
powershell下可执行的部分命令示例：
检查：  
`npx -p @google/design.md designmd lint DESIGN.md`  
导出：    
`npx @google/design.md export --format css-tailwind DESIGN.md > theme.css`  
 ` > theme.css` 的意思是将结果保存到theme.css的文件中。
