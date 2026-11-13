# 内置 Provider、署名与快照政策

核查日期：2026-11-13。执行配置在 `src/providers/policy.ts`，资源请求在 `src/map/network.ts`。下表描述本版本实际开启的能力；数据许可、公共服务器使用条件和软件代码许可分别处理。

## 能力表

| Provider | 在线访问与缓存 | 区域离线下载 / 原始数据包 | 已渲染图片 / 冻结快照 | 必须保留的来源 |
| --- | --- | --- | --- | --- |
| OpenFreeMap | 按视口请求；HTTP 缓存；本应用最多 4 并发 | 本应用均关闭。服务条款虽有有限离线下载条件，本版本没有实现区域下载器或专属浏览器 User-Agent | 支持带署名的地图图片和图像快照；不把快照当作离线矢量地图 | OpenFreeMap、OpenMapTiles、OpenStreetMap contributors；打印保留完整版权 URL |
| Mapterhorn | Terrarium / 512 px WebP；HTTP 缓存；本应用最多 4 并发 | 本应用均关闭。上游另有正式 PMTiles 下载/区域提取路径，不能据此推导无限 z/x/y 抓取额度 | 支持带官方来源清单链接的地图图片与冻结快照；各地区原始数据许可仍适用 | Mapterhorn 及官方列出的原始高程提供者 |
| AWS Terrain Tiles | 可选 Terrarium / 256 px；HTTP 缓存；本应用最多 4 并发 | 本应用均关闭。无 AWS 账号访问是访问方式，不是新的数据许可或无限服务承诺 | 支持带来源清单的图片与冻结快照；不能以“AWS 数据”代替逐源署名 | Terrain Tiles / Mapzen，以及 Tilezen 的原始数据署名清单 |
| Photon demo | 仅显式提交；串行、至少 1.2 秒间隔、24 小时会话内缓存；遵守 Retry-After | 无离线搜索库；不批量抓取 geocoder 数据库 | 用户确认后的地点证据可保存在项目；`bundleAllowed` 仅指这些项目记录，不代表允许复制服务数据库 | OpenStreetMap contributors；保留候选来源、查询原文与解析时间 |
| 用户配置的 AI 网关 | 默认不发送照片；服务器保管密钥；风格化和地点建议分别授权 | 不包含模型权重或第三方服务的离线能力 | 返回素材的使用条件由所配置服务决定；没有统一“AI 素材开放许可” | Provider、模型、输入 hash、用途、生成时间；地点仍须人工确认 |

`snapshotBundleAllowed` 只表示本版本可保存带来源信息的已渲染画面。它不授予原始瓦片、DEM、数据库或任意第三方资产新的再分发权。自定义 Provider 必须声明完整策略；未知/关闭的能力不能靠换服务端点绕过。

## 本轮核查与实现决定

### OpenFreeMap、OpenMapTiles、OpenStreetMap

OpenFreeMap 的条款更新于 **2026-10-14**，有限离线区域下载须满足每次最多 3,000 瓦片或 50 MB、最多 4 并发以及识别应用的专属 User-Agent。本应用没有开放此功能；正常渲染只请求当前视口。公开服务按现状提供，没有 SLA。[1][2]

底图的 OSM 数据、OpenMapTiles schema 和服务名称均需相应署名。电子地图提供安全的可点击来源链接；图片和印刷输出写入完整 URL。OSM 官方说明在无法点击链接的介质中保留版权页完整地址；OpenMapTiles 对静态/印刷地图也要求邻近图片的可见文字署名。[3][4]

### Mapterhorn

官方将 **代码 BSD-3-Clause** 与 **多种原始地形数据许可** 分列，后者通过 attribution 页面及机器可读列表维护。因此 `Mapterhorn = BSD 地形数据` 是错误解释。本轮实际 TileJSON 的署名指向 `https://mapterhorn.com/attribution`；应用保留该官方长列表链接，并在渲染回执中保存来源许可 URL。[5][6]

官方明确提供 Terrarium 512 px WebP 单瓦片服务及 PMTiles 区域提取文档。该事实支持正式数据下载路径的存在，不等于对公共 z/x/y 服务做任意预取。当前应用禁用 DEM 原始数据打包、区域下载和离线地形编辑；已保存的图像快照可继续排版。[7]

本轮 `https://download.mapterhorn.com/attribution.json` 返回 HTTP 403，未将“机器可读逐源清单已完整下载核查”记为完成。官方网页、数据访问说明和实际 TileJSON 均可核对。对于需要特定地区原始许可原文、离线原始 DEM 分发或合同保证的部署，应先取得该地区对应许可与署名材料，不能只引用项目代码许可证。[5][6][7]

### AWS Terrain Tiles

AWS Registry 的 **License** 字段直接指向 Tilezen/Joerd 的 `docs/attribution.md`。该文件区分多个原始数据源的许可证和署名；Mapzen 的权利说明也要求遵守原始提供者义务。应用因此把直接的 Tilezen 来源清单 URL 写入打印署名，而非仅链接 AWS 产品页。[8][9][10]

AWS Registry 记录无账号访问的 S3 桶及引用方式；这不构成统一的“AWS 开放数据许可证”。4 并发是本应用的保守上限，不是 AWS 或 Mapterhorn 公布的服务额度。[8]

### Photon

Photon 软件采用 Apache-2.0；搜索结果来自 OSM，公共 demo 服务仅允许合理请求量，并可限流或停用。软件开源不能解释成公共 demo 无限使用。本应用的 1.2 秒间隔、单并发、缓存和显式提交是自身限制，不冒充官方承诺的固定配额。[11]

## 可执行边界

- 底图、DEM、字形通过同一 Provider 请求调度器执行并发、缓存、取消及 Retry-After；不会通过轮换端点规避限流。
- 导出须至少完成一张真实底图瓦片，并等待所请求瓦片、字形和 DEM；网络/字形解析失败不能被本地字体回退掩盖。
- 路线、风格或相机变化后，旧图像快照不能冒充当前地图；快照的实际像素不足时不放大成“4K”。
- 冻结回执保存 `attribution`、`printAttribution`、`sourceLicenseURLs`、Provider 版本、地形来源与快照允许标记。图片署名是作品内容，不随装饰开关消失。
- 第三方瓦片和 DEM 不随应用发行包再分发。发行包须包含软件依赖、所附字体及本仓库自带素材的相应许可证；用户导入照片及 AI 产物的权利来源单独保存。

## 官方来源

1. [OpenFreeMap Terms of Service](https://openfreemap.org/tos/) — 本轮显示更新日 2026-10-14。
2. [OpenFreeMap Quick Start](https://openfreemap.org/quick_start/) — 官方署名示例、离线下载条件与自建说明。
3. [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright) — ODbL、署名和打印 URL。
4. [OpenMapTiles Attribution](https://openmaptiles.org/docs/terminology/attribution/)；[官方仓库 README](https://github.com/openmaptiles/openmaptiles/blob/master/README.md) — schema 署名与静态/打印地图要求。
5. [Mapterhorn 官方主页 / License](https://mapterhorn.com/#license) — 代码许可与地形数据许可分列。
6. [Mapterhorn Attribution](https://mapterhorn.com/attribution/)；[机器可读来源列表](https://download.mapterhorn.com/attribution.json)；[官方 TileJSON](https://tiles.mapterhorn.com/tilejson.json)。
7. [Mapterhorn Data Access](https://mapterhorn.com/data-access/)；[官方 Distribution 文档](https://github.com/mapterhorn/mapterhorn/blob/main/distribution/README.md)。
8. [AWS Registry: Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) — License、桶、无账号访问与引用方式。
9. [Tilezen/Joerd: Terrain Attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) — 逐源署名和许可。
10. [Mapzen Data Rights and Attribution](https://www.mapzen.com/rights/) — 原始提供者的义务和地形来源入口。
11. [Photon 官方仓库：Demo server / License](https://github.com/komoot/photon#demo-server) — 公共服务使用条件与软件许可。
