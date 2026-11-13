import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as ts from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

// These are the plan's responsibility IDs. Implementations are verified below;
// registering a name here never creates a component or counts an empty wrapper.
const groups = [
  ['P', '基础控件', 'src/ui/primitives.tsx', [
    ['Surface', '连续圆角材质容器'], ['Button', '按钮、忙碌与禁用状态'], ['IconButton', '带可访问名称的图标按钮'],
    ['Segmented', '单选分段控件'], ['Switch', '布尔参数开关'], ['Checkbox', '原子及部分选择状态'],
    ['Field', '输入标题与说明'], ['Parameter', '数值滑杆'], ['Select', '带标签的选择器'],
    ['Tooltip', '简短控件提示'], ['Badge', '来源和状态标记'], ['TaskFeedback', '任务阶段、失败与取消'],
  ]],
  ['C', '共享组合', 'src/ui/shared.tsx', [
    ['Toolbar', '工作区工具栏'], ['SearchBox', '地点查询入口'], ['Popover', '可收起浮层'], ['Panel', '侧栏结构'],
    ['VirtualList', '有界窗口列表'], ['PhotoCard', '照片缩略卡与组数'], ['SourcedField', '值与证据来源'],
    ['ReorderList', '拖放与键盘等价排序'], ['DirectControls', '对象几何参数组'], ['PresetCard', '模板与风格预设卡'],
  ]],
];
const business = [
  ['WorkspaceShell', 'src/app/App.tsx', '工作区模式与材质等级'],
  ['ProjectActions', 'src/app/App.tsx', '项目、保存状态与撤销重做'],
  ['ImportStrip', 'src/app/App.tsx', '照片导入、待定位与取消'],
  ['Atlas', 'src/app/Atlas.tsx', '地图浏览、投影与照片覆盖'],
  ['PlaceDetail', 'src/app/Dialogs.tsx', '地点和到访证据编辑'],
  ['SelectionRules', 'src/app/JourneyPanel.tsx', '固定日期/半径筛选规则'],
  ['CandidateList', 'src/app/JourneyPanel.tsx', '候选照片与选入原因'],
  ['JourneyPanel', 'src/app/JourneyPanel.tsx', '行程选取及编辑会话'],
  ['VisitOrderEditor', 'src/app/JourneyPanel.tsx', '到访顺序与未决项'],
  ['RouteSettings', 'src/app/EditorPanels.tsx', '示意路线及箭头开关'],
  ['ArtworkCanvas', 'src/app/ArtworkCanvas.tsx', '作品显示、命中与变换'],
  ['ElementPanel', 'src/app/EditorPanels.tsx', '元素组及独立可见性'],
  ['LayoutAssistant', 'src/app/EditorPanels.tsx', '自动/辅助/自由排版'],
  ['TemplateLibrary', 'src/app/EditorPanels.tsx', '六家族模板及安装模板'],
  ['StyleLibrary', 'src/app/EditorPanels.tsx', '六种风格、配色及安装风格'],
  ['ObjectInspector', 'src/app/EditorPanels.tsx', '位置、尺寸、裁切锁定'],
  ['PhotoPanel', 'src/app/EditorPanels.tsx', '照片裁切与本地艺术参数'],
  ['TextEditor', 'src/app/EditorPanels.tsx', '标题及寄语编辑'],
  ['ExportDialog', 'src/app/Dialogs.tsx', '图片/打印输出与资源阶段'],
  ['ProjectDialog', 'src/app/Dialogs.tsx', '新建、打开及项目包'],
  ['SettingsDialog', 'src/app/Dialogs.tsx', '应用配置与扩展安装'],
  ['Diagnostics', 'src/app/Dialogs.tsx', '任务状态与诊断记录'],
];
const ui = groups.flatMap(([prefix, group, file, entries]) => entries.map(([name, responsibility], index) => ({ id: `${prefix}${String(index + 1).padStart(2, '0')}`, group, file, name, responsibility })));
ui.push(...business.map(([name, file, responsibility], index) => ({ id: `B${String(index + 1).padStart(2, '0')}`, group: '业务组件', file, name, responsibility })));
const scene = [
  ['background', '画板背景', 'M08', 'renderArtwork'], ['paper', '纸张轮廓、孔洞与材质', 'M08', 'renderArtwork'],
  ['map', '冻结地图画框', 'M05 + M08', 'drawNode'], ['photo', '照片、裁切与编辑', 'M07 + M08', 'drawNode'],
  ['text', '文字及排版', 'M08', 'drawNode'], ['annotation', '投影地点、编号与照片绑定', 'M05 + M08', 'drawNode'],
  ['route', '按 VisitOrder 绘制的路线', 'M03 + M05', 'createMapController'], ['decoration', '边框、印章、罗盘与绳带', 'M08', 'drawNode'],
  ['group', '分组及父级可见性', 'M08', 'isNodeVisible'], ['attribution', '必要来源署名保护区', 'M08 + M09', 'drawNode'],
].map(([kind, responsibility, owner, render], index) => ({ id: `SC${String(index + 1).padStart(2, '0')}`, kind, responsibility, owner, render }));
const modules = [
  ['M01', 'app + ui', '界面、交互、服务装配'], ['M02', 'domain', '可序列化契约、校验、事务历史'],
  ['M03', 'journey', '选择、顺序、冻结行程'], ['M04', 'geo', '纯地理计算'], ['M05', 'map', '地图、相机、地形、投影'],
  ['M06', 'design-packages', '版本化风格与模板配方'], ['M07', 'photo', '本地照片解码与处理'],
  ['M08', 'composition', '排版提案与共享绘制'], ['M09', 'export', '冻结导出、资源屏障与编码'],
  ['M10', 'providers', '外部服务与政策'], ['M11', 'storage', '资源、恢复及项目包'], ['M12', 'runtime + plugins', '任务与声明式扩展生命周期'],
];
const failures = [];
const compiler = new API({ cwd: process.cwd() });
const snapshot = compiler.updateSnapshot({ openProjects: [path.resolve('tsconfig.json')] });
const project = snapshot.getProject(path.resolve('tsconfig.json'));
if (!project) throw new Error('Cannot inspect the TypeScript project.');
const sources = new Map();
function source(file) {
  if (!sources.has(file)) sources.set(file, project.program.getSourceFile(path.resolve(file)));
  const value = sources.get(file); if (!value) throw new Error(`Missing implementation source: ${file}`); return value;
}
function exported(node) { return node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword); }
function declaration(file, name) {
  for (const statement of source(file).statements) {
    if (!exported(statement)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement.body;
    if (ts.isVariableStatement(statement)) for (const value of statement.declarationList.declarations) if (ts.isIdentifier(value.name) && value.name.text === name) return value.initializer;
  }
}
function meaningfulJSX(node) {
  let found = false;
  function visit(value) {
    if (ts.isJsxElement(value) && (value.openingElement.attributes.properties.length || value.children.some(child => !ts.isJsxText(child) || child.text.trim()))) found = true;
    if (ts.isJsxSelfClosingElement(value) && value.attributes.properties.length) found = true;
    value.forEachChild(visit);
  }
  if (node) visit(node); return found;
}
try {
  if (ui.length !== 44 || ui.filter(item => item.id.startsWith('P')).length !== 12 || ui.filter(item => item.id.startsWith('C')).length !== 10 || ui.filter(item => item.id.startsWith('B')).length !== 22) failures.push('UI responsibility counts must remain P12 + C10 + B22 = 44.');
  if (new Set(ui.map(item => item.id)).size !== ui.length || new Set(ui.map(item => `${item.file}:${item.name}`)).size !== ui.length) failures.push('Inventory IDs or implementation exports are duplicated.');
  for (const item of ui) {
    const implementation = declaration(item.file, item.name);
    if (!implementation) failures.push(`${item.id}: missing concrete exported implementation ${item.file}:${item.name}`);
    else if (!meaningfulJSX(implementation)) failures.push(`${item.id}: ${item.name} renders no concrete nonempty UI; empty forwarding wrappers do not satisfy the inventory.`);
  }
  const schema = source('src/domain/types.ts');
  const union = schema.statements.find(statement => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'SceneNodeKind');
  const kinds = union && ts.isUnionTypeNode(union.type) ? union.type.types.filter(ts.isLiteralTypeNode).map(type => ts.isStringLiteral(type.literal) ? type.literal.text : '') : [];
  if (kinds.length !== 10 || [...kinds].sort().join(',') !== scene.map(item => item.kind).sort().join(',')) failures.push('SceneNodeKind must contain exactly the ten SC responsibilities.');
  const nodeType = schema.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === 'SceneNode');
  const kindField = nodeType?.members.find(member => member.name && ts.isIdentifier(member.name) && member.name.text === 'kind');
  if (!kindField?.type || !ts.isTypeReferenceNode(kindField.type) || !ts.isIdentifier(kindField.type.typeName) || kindField.type.typeName.text !== 'SceneNodeKind') failures.push('SceneNode.kind must use the checked SceneNodeKind union.');
  for (const item of scene) {
    const file = item.kind === 'route' ? 'src/map/controller.ts' : 'src/composition/render.ts';
    const implementation = declaration(file, item.render);
    if (!implementation || !ts.isBlock(implementation) || !implementation.statements.length) failures.push(`${item.id}: missing rendering/visibility owner ${file}:${item.render}`);
  }
} finally { snapshot.dispose(); compiler.close(); }

const rows = entries => entries.map(values => `| ${values.join(' | ')} |`).join('\n');
const document = `# 组件与场景责任清单

本文件由 \`node scripts/check-inventory.mjs --write\` 根据实际导出实现生成，并由默认检查校验。ID 对应方案责任；文件数、辅助函数数和屏幕实例数不是组件数量。当前为 **44 个 UI 责任（P12 + C10 + B22）、10 个场景节点、12 个模块**。

检查器读取 TypeScript AST：每个 UI ID 必须映射到唯一、真实导出的非空渲染实现；SceneNode.kind 必须引用准确的十项联合类型，并有实际绘制/可见性函数。它不以一个名称注册或空转发包装器替代实现。\`Modal\`、\`AIConsentDialog\` 等辅助组件不重复计数。

## UI 组件

| ID | 层级 | 导出 | 实现文件 | 责任 |
| --- | --- | --- | --- | --- |
${rows(ui.map(item => [item.id, item.group, `\`${item.name}\``, `\`${item.file}\``, item.responsibility]))}

## 场景节点

全部场景数据类型定义在 \`src/domain/types.ts\`（M02）；渲染与资源职责如下。地图路线由 M05 绘制，M08 使用相同画框投影绘制注记，避免重复路线。

| ID | SceneNodeKind | 责任 | 实现模块 | 绘制/行为入口 |
| --- | --- | --- | --- | --- |
${rows(scene.map(item => [item.id, `\`${item.kind}\``, item.responsibility, item.owner, `\`${item.render}\``]))}

## 模块映射

| ID | 源码目录 | 责任 |
| --- | --- | --- |
${rows(modules.map(([id, directory, responsibility]) => [id, `\`${directory}\``, responsibility]))}

模块导入、公开入口和运行时无环性由 \`scripts/check-boundaries.mjs\` 单独检查。组件清单验证结构契约；交互、键盘操作、视觉品质及真实网络资源须由各自测试和浏览器验收确认。
`;
if (!failures.length && process.argv.includes('--write')) await fs.writeFile('docs/COMPONENTS.md', document);
else if (!failures.length) {
  let current = ''; try { current = await fs.readFile('docs/COMPONENTS.md', 'utf8'); } catch { /* A missing generated catalog is a failure. */ }
  if (current !== document) failures.push('docs/COMPONENTS.md is missing or stale; run node scripts/check-inventory.mjs --write.');
}
if (failures.length) { process.stderr.write(`${failures.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write('Responsibility inventory passed: 44 concrete UI exports, 10 scene kinds, 12 module mappings.\n');
