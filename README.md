# Travel Studio

把照片与走过的地方，制作成可收藏、可继续编辑的旅行作品。

[在线网页版（启用 Pages 后）](https://blackkcold.github.io/Travel-Studio/) · [English](README.en.md) · [下载发行包](https://github.com/blackkcold/Travel-Studio/releases/latest) · [使用说明](docs/USER_GUIDE.md) · [验收记录](docs/ACCEPTANCE.md)

GitHub Pages 提供免安装静态网页版（地图、编辑、导出和项目保存在当前浏览器）；**不包含本地 AI 网关**。网页版与 `127.0.0.1` 的浏览器存储互不相通，迁移请导出／导入 `.travelstudio` 项目包。

## 开始使用

从 Releases 下载 `Travel-Studio-版本号.zip`，解压后安装 **Node.js 24**，运行 `start.bat`（Windows）、`start.command`（macOS）或 `sh start.sh`（Linux）。浏览器打开 **http://127.0.0.1:4173**。

从源码启动：

```sh
npm ci
npm run build
npm start
```

添加照片或确认地点 → 选取和排列到访 → 创作作品 → 导出图片或保存项目包。基础功能无需账号或付费 API 密钥。

## 能力

| 创作 | 内容 |
| --- | --- |
| 真实地图 | 2D 矢量地图、地形 3D、建筑拉伸、独立作品取景、按到访顺序连线 |
| 旅行资料 | 本地 EXIF、照片／地点／到访分离、重访保留、日期与距离选择、未知信息保持未知 |
| 作品排版 | 6 个模板家族、12 种结构、6 套风格与各 2 套配色；自动／辅助／自由排版 |
| 照片与编辑 | 原图保留、本地艺术处理、裁切、位置与尺寸独立锁定、显隐、撤销重做 |
| 图片输出 | PNG／JPEG／WebP，最高 4096 像素长边；透明展示、毫米／PPI／出血印刷输出 |
| 保存与扩展 | 本机自动保存、完整／当前作品项目包、资源校验、许可允许的地图快照、声明式扩展 |

可选 AI 通过本机网关提供照片艺术化和待确认地点候选。每种用途需单独授权；密钥只保存在服务端配置。[部署与服务配置](docs/DEPLOYMENT.md)

照片默认保存在本机。在线地图和地点搜索需要联网；已保存作品可使用匹配的地图快照。项目包包含原图与位置，公开分享请使用导出图片。浏览器清理数据前，请下载 `.travelstudio` 项目包。

## 开发与验证

```sh
npm run dev
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

[组件台账](docs/COMPONENTS.md) · [模块边界](docs/ARCHITECTURE.md) · [项目格式](docs/FORMAT.md) · [扩展样例](examples/extensions) · [验证范围与设备边界](docs/ACCEPTANCE.md)

MIT License。第三方代码、字体及地图数据分别保留各自许可，见 [第三方声明](docs/THIRD_PARTY_NOTICES.md) 与 [服务来源](docs/PROVIDERS.md)。
