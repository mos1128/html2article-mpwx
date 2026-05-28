# html2article-mpwx

将带有行内样式的 HTML 代码一键注入微信公众号图文编辑器正文，并自动处理图片上传到微信 CDN。

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目目录
4. 在微信公众号编辑器页面点击工具栏图标即可使用

## 使用流程

1. 在弹窗的文本框中粘贴 HTML 代码
2. 插件自动检测 HTML 中的图片，根据类型分别处理：
   - **远程图片 / data:URL 图片**：自动下载并上传到微信 CDN，完成后「注入到正文」按钮变为可用
   - **本地图片（相对路径）**：显示红色提示"本体图片需要上传才可以注入到正文"，出现「上传图片」按钮，需选择包含图片的文件夹进行匹配上传
   - **微信 CDN 图片**：自动跳过，直接使用
3. 图片处理过程中会实时显示进度和图片列表，已上传的图片旁边有复制按钮可复制 CDN 链接
4. 所有图片就绪后点击「注入到正文」，HTML 内容被插入编辑器正文
5. 注入成功后按钮变为「清空内容」，点击可清空文本框重新输入
6. 支持 `Ctrl + Enter` 快捷注入


## 图片处理流程

插件将 HTML 中的 `<img>` 按 src 类型分为四类：

| 分类     | src 示例                      | 处理方式                                                  |
| -------- | ----------------------------- | --------------------------------------------------------- |
| 微信 CDN | `https://mmbiz.qpic.cn/...`   | 跳过，直接使用                                            |
| 远程图片 | `https://example.com/img.jpg` | 通过 Background Service Worker 下载，转为 data:URL 后上传 |
| 本地图片 | `images/photo.jpg`            | 用户选择文件夹，按文件名匹配后上传                        |
| data:URL | `data:image/png;base64,...`   | 直接上传                                                  |

处理完成后，HTML 中所有图片的 src 被替换为微信 CDN 地址，未成功上传的 `<img>` 标签会被移除。

## 图片上传技术细节

### 上传接口

```
POST /cgi-bin/filetransfer
```

此接口是微信公众号后台的内部接口（非公开 API），用于上传素材文件。

### 请求参数

#### URL Query 参数

| 参数        | 值                | 说明                          |
| ----------- | ----------------- | ----------------------------- |
| `action`    | `upload_material` | 上传操作类型                  |
| `f`         | `json`            | 返回 JSON 格式                |
| `scene`     | `8`               | 图文编辑器内图片上传场景      |
| `writetype` | `doublewrite`     | 双写模式（临时存储 + 素材库） |
| `groupid`   | `1`               | 分组 ID                       |
| `token`     | 从页面获取        | 登录认证令牌                  |
| `lang`      | `zh_CN`           | 语言                          |
| `ticket`    | 从页面获取        | 鉴权票据                      |
| `ticket_id` | 从页面获取        | 票据 ID（可选）               |
| `svr_time`  | 从页面获取        | 服务器时间（可选）            |
| `seq`       | `Date.now()`      | 序列号（毫秒时间戳）          |
| `t`         | `Math.random()`   | 随机数（防缓存）              |

#### FormData 字段

微信公众号编辑器基于百度 WebUploader，要求 FormData 包含以下字段：

| 字段               | 示例值                | 说明                             |
| ------------------ | --------------------- | -------------------------------- |
| `id`               | `WU_FILE_0`           | 文件唯一标识（WebUploader 格式） |
| `name`             | `upload.jpeg`         | 文件名                           |
| `type`             | `image/jpeg`          | MIME 类型                        |
| `lastModifiedDate` | `Wed May 28 2026 ...` | 最后修改时间                     |
| `size`             | `218039`              | 文件大小（字节）                 |
| `file`             | (binary)              | 文件二进制数据                   |

### 认证参数获取

认证参数从页面 JavaScript 全局对象获取，在页面主上下文（MAIN world）中执行：

```javascript
const wxData = window.wx.data;

wxData.t            // token，登录认证令牌
wxData.ticket        // 鉴权票据
wxData.ticket_id     // 票据 ID
wxData.svr_time      // 服务器时间
```

若 `window.wx.data.t` 不可用，则从当前页面 URL 的 `?token=xxx` 参数中获取。

### 响应结构

上传成功时返回：

```json
{
  "base_resp": { "ret": 0, "err_msg": "ok" },
  "content": "10000519",
  "cdn_url": "https://mmbiz.qpic.cn/sz_mmbiz_jpg/xxx/0?wx_fmt=jpeg&from=appmsg",
  "type": "image",
  "location": "bizfile"
}
```

| 字段            | 说明                                        |
| --------------- | ------------------------------------------- |
| `base_resp.ret` | 返回码，`0` 表示成功，`200002` 表示参数无效 |
| `content`       | 素材内容 ID                                 |
| `cdn_url`       | CDN 地址，用于替换 HTML 中的 img src        |
| `type`          | 文件类型                                    |
| `location`      | 存储位置                                    |

**注意：** CDN 链接在 `cdn_url` 字段而非 `content` 字段。`content` 仅为数字 ID。

### 脚本注入方式

上传函数通过 Chrome Extension API 注入到页面主上下文执行：

```javascript
chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',    // 在页面主上下文中执行，可访问 window.wx 和 cookie
    func: uploadImageInPageContext,
    args: [dataUrl, mimeType]
});
```

使用 `world: 'MAIN'` 的原因：
- 需要访问 `window.wx.data` 获取认证参数
- XHR 请求需要携带页面的 cookie 和 session
- 同源请求不需要额外处理 CORS

远程图片下载则在 Background Service Worker 中通过 `fetch` 完成（不受 CORS 限制）。

### 完整上传流程

```
HTML 中的图片 src
    │
    ├─ 远程 URL ──→ background.js fetch 下载 ──→ data:URL ──┐
    ├─ 本地路径 ──→ 用户选择文件夹 ──→ FileReader ──→ data:URL ──┤
    └─ data:URL ────────────────────────────────────────────┤
                                                            ▼
                                            chrome.scripting.executeScript
                                                    (world: MAIN)
                                                            │
                                            uploadImageInPageContext()
                                                            │
                                            POST /cgi-bin/filetransfer
                                                            │
                                            响应 cdn_url ──→ 替换 HTML 中的 src
```

## UI 设计

弹窗采用 Google Material Design 风格：
- 蓝色标题栏（`#1a73e8`），卡片式布局
- 图片处理区实时展示图片列表，已上传图片旁有复制 CDN 链接按钮
- 按钮根据操作状态动态切换（主按钮/次按钮/禁用）
- 进度条带旋转动画，Toast 通知滑入显示

## 项目结构

```
html2article-mpwx/
├── manifest.json        # 扩展清单（Manifest V3）
├── background.js        # Service Worker，处理远程图片下载
├── popup.html           # 弹窗 UI（Material Design 风格）
├── popup.js             # 弹窗主逻辑 + 按钮状态管理 + 图片上传 + HTML 注入
├── image-handler.js     # 图片分类、URL 替换、CDN 上传调度
├── css-inline.js        # CSS <style> 标签转行内样式
└── icons/               # 扩展图标
```

### 文件职责

| 文件               | 职责                                                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `popup.js`         | UI 交互、按钮状态管理（`updateActionButtons`）、图片列表渲染（`updateImageActionUI`）、CDN 链接复制（`copyToClipboard`）、`uploadImageInPageContext`（注入到页面执行的上传函数）、`injectHTMLToWeChat`（注入到页面执行的 HTML 插入函数） |
| `image-handler.js` | `classifyImages`（图片分类）、`replaceImageUrls`（URL 替换）、`uploadImageToWeChatCDN`（调用 chrome.scripting 注入上传函数）、`fetchImageViaBackground`（消息通信下载远程图片）                                                          |
| `background.js`    | `fetchImage`（下载远程图片并转 base64）、`arrayBufferToBase64`（类型转换）                                                                                                                                                               |
| `css-inline.js`    | `convertStylesToInline`（解析 HTML 中 `<style>` 标签，将 CSS 规则转为元素行内 style 属性）                                                                                                                                               |

## 注意事项

- 扩展仅在 `mp.weixin.qq.com` 页面生效
- 图片上传依赖公众号后台的登录态（token），需在已登录的编辑器页面使用
- 微信公众号后台接口为内部接口，可能随版本更新变化参数格式
- HTML 中的 `text-indent` 样式和段落开头的空白字符会在注入时自动清除
- 注入位置为编辑器正文区域的最前面（`insertAdjacentHTML('afterbegin')`）
- 已上传图片的 CDN 链接可通过图片列表中的复制按钮一键复制到剪贴板
