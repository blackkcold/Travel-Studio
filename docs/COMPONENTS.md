# 组件与场景责任清单

本文件由 `node scripts/check-inventory.mjs --write` 根据实际导出实现生成，并由默认检查校验。ID 对应方案责任；文件数、辅助函数数和屏幕实例数不是组件数量。当前为 **44 个 UI 责任（P12 + C10 + B22）、10 个场景节点、12 个模块**。

检查器读取 TypeScript AST：每个 UI ID 必须映射到唯一、真实导出的非空渲染实现；SceneNode.kind 必须引用准确的十项联合类型，并有实际绘制/可见性函数。它不以一个名称注册或空转发包装器替代实现。`Modal`、`AIConsentDialog` 等辅助组件不重复计数。

## UI 组件

| ID | 层级 | 导出 | 实现文件 | 责任 |
| --- | --- | --- | --- | --- |
| P01 | 基础控件 | `Surface` | `src/ui/primitives.tsx` | 连续圆角材质容器 |
| P02 | 基础控件 | `Button` | `src/ui/primitives.tsx` | 按钮、忙碌与禁用状态 |
| P03 | 基础控件 | `IconButton` | `src/ui/primitives.tsx` | 带可访问名称的图标按钮 |
| P04 | 基础控件 | `Segmented` | `src/ui/primitives.tsx` | 单选分段控件 |
| P05 | 基础控件 | `Switch` | `src/ui/primitives.tsx` | 布尔参数开关 |
| P06 | 基础控件 | `Checkbox` | `src/ui/primitives.tsx` | 原子及部分选择状态 |
| P07 | 基础控件 | `Field` | `src/ui/primitives.tsx` | 输入标题与说明 |
| P08 | 基础控件 | `Parameter` | `src/ui/primitives.tsx` | 数值滑杆 |
| P09 | 基础控件 | `Select` | `src/ui/primitives.tsx` | 带标签的选择器 |
| P10 | 基础控件 | `Tooltip` | `src/ui/primitives.tsx` | 简短控件提示 |
| P11 | 基础控件 | `Badge` | `src/ui/primitives.tsx` | 来源和状态标记 |
| P12 | 基础控件 | `TaskFeedback` | `src/ui/primitives.tsx` | 任务阶段、失败与取消 |
| C01 | 共享组合 | `Toolbar` | `src/ui/shared.tsx` | 工作区工具栏 |
| C02 | 共享组合 | `SearchBox` | `src/ui/shared.tsx` | 地点查询入口 |
| C03 | 共享组合 | `Popover` | `src/ui/shared.tsx` | 可收起浮层 |
| C04 | 共享组合 | `Panel` | `src/ui/shared.tsx` | 侧栏结构 |
| C05 | 共享组合 | `VirtualList` | `src/ui/shared.tsx` | 有界窗口列表 |
| C06 | 共享组合 | `PhotoCard` | `src/ui/shared.tsx` | 照片缩略卡与组数 |
| C07 | 共享组合 | `SourcedField` | `src/ui/shared.tsx` | 值与证据来源 |
| C08 | 共享组合 | `ReorderList` | `src/ui/shared.tsx` | 拖放与键盘等价排序 |
| C09 | 共享组合 | `DirectControls` | `src/ui/shared.tsx` | 对象几何参数组 |
| C10 | 共享组合 | `PresetCard` | `src/ui/shared.tsx` | 模板与风格预设卡 |
| B01 | 业务组件 | `WorkspaceShell` | `src/app/App.tsx` | 工作区模式与材质等级 |
| B02 | 业务组件 | `ProjectActions` | `src/app/App.tsx` | 项目、保存状态与撤销重做 |
| B03 | 业务组件 | `ImportStrip` | `src/app/App.tsx` | 照片导入、待定位与取消 |
| B04 | 业务组件 | `Atlas` | `src/app/Atlas.tsx` | 地图浏览、投影与照片覆盖 |
| B05 | 业务组件 | `PlaceDetail` | `src/app/Dialogs.tsx` | 地点和到访证据编辑 |
| B06 | 业务组件 | `SelectionRules` | `src/app/JourneyPanel.tsx` | 固定日期/半径筛选规则 |
| B07 | 业务组件 | `CandidateList` | `src/app/JourneyPanel.tsx` | 候选照片与选入原因 |
| B08 | 业务组件 | `JourneyPanel` | `src/app/JourneyPanel.tsx` | 行程选取及编辑会话 |
| B09 | 业务组件 | `VisitOrderEditor` | `src/app/JourneyPanel.tsx` | 到访顺序与未决项 |
| B10 | 业务组件 | `RouteSettings` | `src/app/EditorPanels.tsx` | 示意路线及箭头开关 |
| B11 | 业务组件 | `ArtworkCanvas` | `src/app/ArtworkCanvas.tsx` | 作品显示、命中与变换 |
| B12 | 业务组件 | `ElementPanel` | `src/app/EditorPanels.tsx` | 元素组及独立可见性 |
| B13 | 业务组件 | `LayoutAssistant` | `src/app/EditorPanels.tsx` | 自动/辅助/自由排版 |
| B14 | 业务组件 | `TemplateLibrary` | `src/app/EditorPanels.tsx` | 六家族模板及安装模板 |
| B15 | 业务组件 | `StyleLibrary` | `src/app/EditorPanels.tsx` | 六种风格、配色及安装风格 |
| B16 | 业务组件 | `ObjectInspector` | `src/app/EditorPanels.tsx` | 位置、尺寸、裁切锁定 |
| B17 | 业务组件 | `PhotoPanel` | `src/app/EditorPanels.tsx` | 照片裁切与本地艺术参数 |
| B18 | 业务组件 | `TextEditor` | `src/app/EditorPanels.tsx` | 标题及寄语编辑 |
| B19 | 业务组件 | `ExportDialog` | `src/app/Dialogs.tsx` | 图片/打印输出与资源阶段 |
| B20 | 业务组件 | `ProjectDialog` | `src/app/Dialogs.tsx` | 新建、打开及项目包 |
| B21 | 业务组件 | `SettingsDialog` | `src/app/Dialogs.tsx` | 应用配置与扩展安装 |
| B22 | 业务组件 | `Diagnostics` | `src/app/Dialogs.tsx` | 任务状态与诊断记录 |

## 场景节点

全部场景数据类型定义在 `src/domain/types.ts`（M02）；渲染与资源职责如下。地图路线由 M05 绘制，M08 使用相同画框投影绘制注记，避免重复路线。

| ID | SceneNodeKind | 责任 | 实现模块 | 绘制/行为入口 |
| --- | --- | --- | --- | --- |
| SC01 | `background` | 画板背景 | M08 | `renderArtwork` |
| SC02 | `paper` | 纸张轮廓、孔洞与材质 | M08 | `renderArtwork` |
| SC03 | `map` | 冻结地图画框 | M05 + M08 | `drawNode` |
| SC04 | `photo` | 照片、裁切与编辑 | M07 + M08 | `drawNode` |
| SC05 | `text` | 文字及排版 | M08 | `drawNode` |
| SC06 | `annotation` | 投影地点、编号与照片绑定 | M05 + M08 | `drawNode` |
| SC07 | `route` | 按 VisitOrder 绘制的路线 | M03 + M05 | `createMapController` |
| SC08 | `decoration` | 边框、印章、罗盘与绳带 | M08 | `drawNode` |
| SC09 | `group` | 分组及父级可见性 | M08 | `isNodeVisible` |
| SC10 | `attribution` | 必要来源署名保护区 | M08 + M09 | `drawNode` |

## 模块映射

| ID | 源码目录 | 责任 |
| --- | --- | --- |
| M01 | `app + ui` | 界面、交互、服务装配 |
| M02 | `domain` | 可序列化契约、校验、事务历史 |
| M03 | `journey` | 选择、顺序、冻结行程 |
| M04 | `geo` | 纯地理计算 |
| M05 | `map` | 地图、相机、地形、投影 |
| M06 | `design-packages` | 版本化风格与模板配方 |
| M07 | `photo` | 本地照片解码与处理 |
| M08 | `composition` | 排版提案与共享绘制 |
| M09 | `export` | 冻结导出、资源屏障与编码 |
| M10 | `providers` | 外部服务与政策 |
| M11 | `storage` | 资源、恢复及项目包 |
| M12 | `runtime + plugins` | 任务与声明式扩展生命周期 |

模块导入、公开入口和运行时无环性由 `scripts/check-boundaries.mjs` 单独检查。组件清单验证结构契约；交互、键盘操作、视觉品质及真实网络资源须由各自测试和浏览器验收确认。
