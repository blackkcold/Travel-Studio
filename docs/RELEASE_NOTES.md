# Travel Studio 1.0.0

首个正式版本。将本地照片、地点与到访顺序制作成可保存、可继续编辑的旅行作品。

## 下载与启动

下载本页的 `Travel-Studio-1.0.0.zip` 或 `.tar.gz`，解压并安装 **Node.js 24**。Windows 运行 `start.bat`；macOS 运行 `start.command`；Linux 运行 `sh start.sh`，然后打开 **http://127.0.0.1:4173**。

发行包包含已构建应用、启动服务、使用文档、两份可继续编辑的合成示例项目、扩展样例与第三方许可。示例在 `examples/projects` 中，附来源与文件校验记录。无需安装开发依赖。独立的 `Travel-Studio-1.0.0-verification-evidence.zip` 保留本次发布提交的测试样张、回执、截图及录像；`BUILD.json` 记录源码提交和运行地址，`SHA256SUMS.txt` 提供三份归档的校验值。

## 本版功能

- **旅行资料**：本地读取 EXIF、保留原图；照片、地点、到访分别管理。同一地点的重访保留独立记录；支持时间／手动排序、日期与半径选择、合并／拆分到访和明确时间依据。
- **真实地图**：在线矢量底图、地形 3D、建筑拉伸和到访示意路线；浏览地图与作品取景独立保存。地点搜索须确认候选，无 GPS／时间的照片保持未知状态。
- **作品设计**：6 个模板家族、12 种结构、6 套风格、每套 2 种配色；自动／辅助／自由排版、显隐、裁切、位置与尺寸锁定、撤销与重做。
- **照片处理**：原图与非破坏性本地配方；可选 AI 艺术化保留生成版本，并在应用前核对目标作品与照片状态。
- **输出**：PNG、JPEG、WebP；最长边最高 4096 像素；展示图和按毫米、PPI、出血输出的 sRGB 平面印刷图。导出等待字体与地图资源，并生成可追溯回执。
- **保存与恢复**：本机自动保存、完整／当前作品 `.travelstudio` 项目包、资源哈希校验、嵌入设计版本、允许随包保存的地图快照。损坏项目可从有效历史恢复；较新格式提供只读恢复入口。
- **扩展**：声明式风格、模板与地图来源清单，附安装样例与格式说明。

## 使用边界

基础创作无需账号或付费 API 密钥。实时地图、地形与搜索需要网络；保存的地图快照只能在取景、路线、风格和输出分辨率匹配时复用。在线服务的可用性与使用条件以各服务为准。

AI 是可选功能，需要自行配置服务端凭据，并分别确认艺术化或地点候选用途；本版未通过付费真实模型验证，不承诺定位准确率。地图建筑使用来源高度或明确估算；路线是到访示意，非导航道路。

项目保存在当前浏览器与来源中。清理浏览器数据前请下载 `.travelstudio` 备份；公开分享建议使用导出图片，项目包包含原图和位置资料。

正式发布流程要求当前提交的类型、模块契约、单元测试、构建、真实服务和 Chromium 浏览器验收全部通过。逐项证据、实际文件与限制见 [验收记录](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/ACCEPTANCE.md)。GitHub Linux Chromium 与触屏模拟结果不等同于 Windows、macOS Safari 或手机真机认证；固定设备帧率、长时间编辑、大资料库和专业印刷打样目标仍需独立验证。

## 文档

[使用说明](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/USER_GUIDE.md) · [部署与 AI 配置](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/DEPLOYMENT.md) · [项目格式](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/FORMAT.md) · [扩展说明](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/EXTENSIONS.md) · [服务来源](https://github.com/blackkcold/Travel-Studio/blob/v1.0.0/docs/PROVIDERS.md)

项目采用 MIT License；第三方代码、字体和地图数据保留各自许可及署名。
