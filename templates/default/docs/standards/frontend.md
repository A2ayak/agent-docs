# 前端规范

### 1. 组件选择：优先复用成熟库、组件源代码可控、统一设计语言、严格限制重复依赖。如无特殊说明，统一使用以下方案（括号内为备选或Vue方案）：

- 包管理统一使用 pnpm，并使用 monorepo 架构管理可复用的组件包
- 构建工具统一使用 Vite (如需兼容Webpack则优先 rspack)
- JS开发库优先使用 React，其次 Vue
- UI风格统一使用 Shadcn/ui
- CSS统一使用 TailwindCSS（必要时可使用SCSS，并遵循嵌套写法）
- 图标统一使用 Lucide
- 动画统一使用 Motion
- 拖拽使用譬如 dnd-kit
- 路由库使用 Tanstack Router (Vue Router)
- 状态管理使用譬如 Zustand (Pinia)
- 图表库使用 ECharts (Tanstack Chart)
- 请求库使用 axios 并封装，涉及到AI请求的项目优先使用 fetch
- 如涉及请求状态管理统一使用 TanStack Query

### 2. 前端编码规范

- 命名约定：文件名、函数方法名统一使用Camel Case（驼峰命名）
- 组件格式化库统一使用 biome (oxclint，老项目可以兼容使用Eslint、Prettier)
- 组件开头尽量用中文注释编写组件简称，如“用户页”
- 重要业务以及utils方法函数应该编写注释说明功能

### 3. 单组件结构

```
my-component/
├── api/
│   └── index.ts
├── components/
├── docs/
│   ├── prd.md
│   └── (other).md
├── index.tsx
├── types/
│   └── model.ts
├── (utils)/
│   └── index.ts
└── AGENTS.md
```
