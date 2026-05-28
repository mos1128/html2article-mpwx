// ── SVG Icons ──

const COPY_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const CHECK_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

const FOLDER_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

// ── Main Logic ──

document.addEventListener('DOMContentLoaded', () => {
    const htmlInput = document.getElementById('htmlInput');
    const primaryBtn = document.getElementById('primaryBtn');
    const secondaryBtn = document.getElementById('secondaryBtn');
    const uploadHint = document.getElementById('uploadHint');
    const toastEl = document.getElementById('toast');
    const progressEl = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    const imageActionArea = document.getElementById('imageActionArea');
    const imageStatus = document.getElementById('imageStatus');
    const imageList = document.getElementById('imageList');
    let toastTimer = null;

    // 流程状态
    let injected = false;
    let tabId = null;
    let processedHtml = '';
    let classified = null;
    let uploadedUrlMap = new Map();
    let localFileMap = new Map();
    let uploadedFailed = new Set();

    function showToast(msg, type = 'success') {
        toastEl.textContent = msg;
        toastEl.className = type;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastEl.className = ''; }, 3000);
    }

    function showProgress(text) {
        progressEl.style.display = 'block';
        progressText.innerHTML = '<span class="progress-spinner"></span>' + text;
    }

    function hideProgress() {
        progressEl.style.display = 'none';
    }

    function resetState() {
        injected = false;
        tabId = null;
        processedHtml = '';
        classified = null;
        uploadedUrlMap = new Map();
        localFileMap = new Map();
        uploadedFailed = new Set();
        imageActionArea.style.display = 'none';
        imageStatus.textContent = '';
        imageList.innerHTML = '';
        updateActionButtons();
        hideProgress();
    }

    function copyToClipboard(text, buttonEl) {
        navigator.clipboard.writeText(text).then(() => {
            buttonEl.innerHTML = CHECK_ICON_SVG;
            buttonEl.classList.add('copied');
            showToast('已复制链接');
            setTimeout(() => {
                buttonEl.innerHTML = COPY_ICON_SVG;
                buttonEl.classList.remove('copied');
            }, 2000);
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }

    // ── 按钮状态管理 ──

    function hasLocalImages() {
        return classified && classified.local.length > 0;
    }

    function allLocalImagesDone() {
        if (!classified) return false;
        return classified.local.every(img =>
            uploadedUrlMap.has(img.originalSrc) || uploadedFailed.has(img.originalSrc)
        );
    }

    function updateActionButtons() {
        // 提示文字
        uploadHint.style.display = (hasLocalImages() && !injected) ? '' : 'none';

        if (injected) {
            primaryBtn.style.display = 'none';
            secondaryBtn.textContent = '清空内容';
            secondaryBtn.disabled = false;
            secondaryBtn.className = 'btn btn-primary btn-full';
            return;
        }

        if (!processedHtml) {
            primaryBtn.style.display = 'none';
            secondaryBtn.textContent = '注入到正文';
            secondaryBtn.disabled = true;
            secondaryBtn.className = 'btn btn-primary btn-full';
            return;
        }

        if (hasLocalImages() && !allLocalImagesDone()) {
            primaryBtn.innerHTML = FOLDER_ICON_SVG + ' 上传图片';
            primaryBtn.disabled = false;
            primaryBtn.className = 'btn btn-primary btn-full';
            primaryBtn.style.display = '';

            secondaryBtn.textContent = '忽略图片直接注入正文';
            secondaryBtn.disabled = false;
            secondaryBtn.className = 'btn btn-outlined btn-full';
        } else if (hasLocalImages() && allLocalImagesDone()) {
            primaryBtn.innerHTML = FOLDER_ICON_SVG + ' 上传图片';
            primaryBtn.disabled = false;
            primaryBtn.className = 'btn btn-outlined btn-full';
            primaryBtn.style.display = '';

            secondaryBtn.textContent = '注入到正文';
            secondaryBtn.disabled = false;
            secondaryBtn.className = 'btn btn-primary btn-full';
        } else {
            primaryBtn.style.display = 'none';
            secondaryBtn.textContent = '注入到正文';
            secondaryBtn.disabled = false;
            secondaryBtn.className = 'btn btn-primary btn-full';
        }
    }

    // ── 粘贴 HTML 后自动检测图片 ──

    htmlInput.addEventListener('input', () => {
        const html = htmlInput.value.trim();
        if (!html) {
            resetState();
            return;
        }

        resetState();
        processedHtml = convertStylesToInline(html);
        classified = classifyImages(processedHtml);

        console.log('[html2article] classify:', {
            remote: classified.remote.length,
            local: classified.local.length,
            dataUrl: classified.dataUrl.length,
            skip: classified.skip.length
        });

        const needUpload = classified.remote.length + classified.local.length + classified.dataUrl.length;
        if (needUpload === 0) {
            updateActionButtons();
            return;
        }

        updateActionButtons();
        ensureTabId().then(() => {
            startImageProcessing();
        });
    });

    htmlInput.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!secondaryBtn.disabled) secondaryBtn.click();
        }
    });

    async function ensureTabId() {
        if (tabId) return;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.url.includes('mp.weixin.qq.com')) {
            showToast('请在微信公众号编辑器页面使用！', 'error');
            return;
        }
        tabId = tab.id;
    }

    // ── 自动上传远程 / dataUrl 图片 ──

    async function startImageProcessing() {
        const remoteTotal = classified.remote.length;
        const dataUrlTotal = classified.dataUrl.length;
        const localTotal = classified.local.length;
        const autoTotal = remoteTotal + dataUrlTotal;
        let autoDone = 0;

        // 有需要处理的图片就显示图片区域
        imageActionArea.style.display = 'block';
        updateImageActionUI();

        if (autoTotal > 0) {
            showProgress(`正在处理图片 0/${autoTotal}...`);
        }

        for (const item of classified.remote) {
            const result = await fetchImageViaBackground(item.originalSrc);
            if (result.success) {
                const cdnUrl = await uploadImageToWeChatCDN(tabId, result.dataUrl, result.mimeType);
                if (cdnUrl) {
                    uploadedUrlMap.set(item.originalSrc, cdnUrl);
                } else {
                    uploadedFailed.add(item.originalSrc);
                }
            } else {
                uploadedFailed.add(item.originalSrc);
            }
            autoDone++;
            if (autoTotal > 0) showProgress(`正在处理图片 ${autoDone}/${autoTotal}...`);
            updateImageActionUI();
        }

        for (const item of classified.dataUrl) {
            const cdnUrl = await uploadImageToWeChatCDN(tabId, item.originalSrc, item.mimeType);
            if (cdnUrl) {
                uploadedUrlMap.set(item.originalSrc, cdnUrl);
            } else {
                uploadedFailed.add(item.originalSrc);
            }
            autoDone++;
            if (autoTotal > 0) showProgress(`正在处理图片 ${autoDone}/${autoTotal}...`);
            updateImageActionUI();
        }

        if (localTotal > 0) {
            updateImageActionUI();
        }

        hideProgress();

        if (uploadedFailed.size > 0) {
            showToast(`${uploadedFailed.size} 张图片上传失败`, 'error');
        }

        checkAllDone();
    }

    // ── 图片列表 UI ──

    function updateImageActionUI() {
        imageList.innerHTML = '';
        const allItems = [];

        for (const item of (classified?.remote || [])) {
            const cdnUrl = uploadedUrlMap.get(item.originalSrc);
            const failed = uploadedFailed.has(item.originalSrc);
            const fname = extractFilename(item.originalSrc) || '远程图片';
            if (cdnUrl) {
                allItems.push({ label: fname, cdnUrl, status: 'matched' });
            } else if (failed) {
                allItems.push({ label: fname, cdnUrl: null, status: 'failed' });
            } else {
                allItems.push({ label: fname, cdnUrl: null, status: 'pending' });
            }
        }

        let dataIdx = 0;
        for (const item of (classified?.dataUrl || [])) {
            dataIdx++;
            const cdnUrl = uploadedUrlMap.get(item.originalSrc);
            const failed = uploadedFailed.has(item.originalSrc);
            const fname = `内嵌图片-${dataIdx}`;
            if (cdnUrl) {
                allItems.push({ label: fname, cdnUrl, status: 'matched' });
            } else if (failed) {
                allItems.push({ label: fname, cdnUrl: null, status: 'failed' });
            } else {
                allItems.push({ label: fname, cdnUrl: null, status: 'pending' });
            }
        }

        for (const img of (classified?.local || [])) {
            const cdnUrl = uploadedUrlMap.get(img.originalSrc);
            const failed = uploadedFailed.has(img.originalSrc);
            if (cdnUrl) {
                allItems.push({ label: img.filename, cdnUrl, status: 'matched' });
            } else if (failed) {
                allItems.push({ label: img.filename, cdnUrl: null, status: 'failed' });
            } else {
                allItems.push({ label: img.filename, cdnUrl: null, status: 'missing' });
            }
        }

        const matched = allItems.filter(i => i.status === 'matched').length;
        const total = allItems.length;
        imageStatus.textContent = total > 0
            ? `共 ${total} 张图片，已上传 ${matched} 张`
            : '';

        for (const item of allItems) {
            const row = document.createElement('div');
            row.className = 'image-list-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'image-name ' + item.status;
            nameSpan.textContent = item.label;
            if (item.cdnUrl) nameSpan.title = item.cdnUrl;

            row.appendChild(nameSpan);

            if (item.cdnUrl) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.title = '复制链接';
                copyBtn.innerHTML = COPY_ICON_SVG;
                copyBtn.addEventListener('click', () => copyToClipboard(item.cdnUrl, copyBtn));
                row.appendChild(copyBtn);
            } else if (item.status === 'missing') {
                const badge = document.createElement('span');
                badge.className = 'status-badge badge-missing';
                badge.textContent = '待上传';
                row.appendChild(badge);
            } else if (item.status === 'failed') {
                const badge = document.createElement('span');
                badge.className = 'status-badge badge-failed';
                badge.textContent = '失败';
                row.appendChild(badge);
            } else if (item.status === 'pending') {
                const badge = document.createElement('span');
                badge.className = 'status-badge badge-missing';
                badge.textContent = '处理中';
                row.appendChild(badge);
            }

            imageList.appendChild(row);
        }
    }

    // ── 按钮事件 ──

    primaryBtn.addEventListener('click', async () => {
        await handleUploadLocalImages();
    });

    secondaryBtn.addEventListener('click', async () => {
        const text = secondaryBtn.textContent;
        if (text.includes('清空内容')) {
            htmlInput.value = '';
            resetState();
            return;
        }
        if (text.includes('忽略图片')) {
            await handleInjectSkip();
        } else {
            await injectFinal();
        }
    });

    async function handleUploadLocalImages() {
        const files = await openFolderPicker();
        if (!files || files.length === 0) return;

        const targetFilenames = new Set(
            classified.local
                .filter(img => !uploadedUrlMap.has(img.originalSrc))
                .map(img => img.filename)
        );

        const matchingFiles = Array.from(files).filter(f => targetFilenames.has(f.name));
        if (matchingFiles.length === 0) {
            showToast('所选文件夹中没有匹配的图片', 'error');
            return;
        }

        showProgress(`正在读取 ${matchingFiles.length} 张图片...`);
        const imageDataUrls = await readFilesAsDataUrls(matchingFiles);

        for (const item of imageDataUrls) {
            if (item.dataUrl) {
                localFileMap.set(item.name, item);
            }
        }

        await uploadMatchedLocalImages();
        updateImageActionUI();
        checkAllDone();
        hideProgress();
    }

    async function handleInjectSkip() {
        for (const img of classified.local) {
            if (!uploadedUrlMap.has(img.originalSrc) && !uploadedFailed.has(img.originalSrc)) {
                uploadedFailed.add(img.originalSrc);
            }
        }
        imageActionArea.style.display = 'none';
        await injectFinal();
    }

    function openFolderPicker() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.accept = 'image/*';
            input.onchange = () => resolve(input.files || []);
            input.oncancel = () => resolve(null);
            input.click();
        });
    }

    function readFilesAsDataUrls(files) {
        return Promise.all(
            Array.from(files).map(file => readFileAsDataUrl(file).then(data => ({ ...data, name: file.name })))
        );
    }

    async function uploadMatchedLocalImages() {
        for (const img of classified.local) {
            if (uploadedUrlMap.has(img.originalSrc) || uploadedFailed.has(img.originalSrc)) continue;

            const fileData = localFileMap.get(img.filename);
            if (!fileData) continue;

            showProgress(`正在上传 ${img.filename}...`);
            const cdnUrl = await uploadImageToWeChatCDN(tabId, fileData.dataUrl, fileData.mimeType);
            if (cdnUrl) {
                uploadedUrlMap.set(img.originalSrc, cdnUrl);
                console.log('[html2article] local upload OK:', img.filename, '->', cdnUrl);
            } else {
                uploadedFailed.add(img.originalSrc);
                console.log('[html2article] local upload FAILED:', img.filename);
            }
            updateImageActionUI();
            updateActionButtons();
        }
    }

    // ── 注入正文 ──

    async function injectFinal() {
        await ensureTabId();
        if (!tabId) return;

        const finalHtml = replaceImageUrls(processedHtml, uploadedUrlMap, uploadedFailed);

        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: injectHTMLToWeChat,
            args: [finalHtml]
        }, (injectionResults) => {
            if (chrome.runtime.lastError) {
                showToast('注入失败：' + chrome.runtime.lastError.message, 'error');
                return;
            }
            if (injectionResults && injectionResults[0] && injectionResults[0].result === false) {
                showToast('未找到正文编辑器！', 'error');
                return;
            }

            injected = true;
            updateActionButtons();

            const uploaded = uploadedUrlMap.size;
            const failed = uploadedFailed.size;
            if (uploaded > 0 && failed === 0) {
                showToast(`已成功注入！${uploaded} 张图片已上传`);
            } else if (uploaded > 0 && failed > 0) {
                showToast(`已注入正文，${failed} 张图片未上传`, 'error');
            } else {
                showToast('已成功注入到正文！');
            }
        });
    }

    // ── 检查是否全部完成 ──

    function checkAllDone() {
        const total = (classified ? classified.remote.length + classified.local.length + classified.dataUrl.length : 0);
        const done = uploadedUrlMap.size + uploadedFailed.size;
        if (done >= total) {
            updateActionButtons();
        }
    }
});

function uploadImageInPageContext(dataUrl, mimeType) {
    return new Promise((resolve) => {
        try {
            const wxData = (window.wx && window.wx.data) || {};
            let token = wxData.t;
            if (!token) {
                const match = window.location.search.match(/[?&]token=([^&]+)/);
                if (match) token = match[1];
            }
            console.log('[html2article] upload token:', token || '未找到');
            if (!token) { resolve(null); return; }

            const ticket = wxData.ticket || '';
            const ticketId = wxData.ticket_id || '';
            const svrTime = wxData.svr_time || '';
            console.log('[html2article] upload ticket_id:', ticketId, 'svr_time:', svrTime);

            const byteString = atob(dataUrl.split(',')[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const blob = new Blob([ab], { type: mimeType });
            const ext = mimeType.split('/')[1] || 'png';
            const file = new File([blob], 'upload.' + ext, { type: mimeType });
            console.log('[html2article] upload file:', file.name, file.size, 'bytes');

            const fd = new FormData();
            fd.append('id', 'WU_FILE_0');
            fd.append('name', file.name);
            fd.append('type', mimeType);
            fd.append('lastModifiedDate', new Date().toString());
            fd.append('size', String(file.size));
            fd.append('file', file);

            const seq = Date.now();
            const t = Math.random();
            const params = new URLSearchParams({
                action: 'upload_material',
                f: 'json',
                scene: '8',
                writetype: 'doublewrite',
                groupid: '1',
                token: token,
                lang: 'zh_CN',
                seq: String(seq),
                t: String(t)
            });
            if (ticketId) params.set('ticket_id', ticketId);
            if (ticket) params.set('ticket', ticket);
            if (svrTime) params.set('svr_time', String(svrTime));
            const uploadUrl = '/cgi-bin/filetransfer?' + params.toString();
            console.log('[html2article] upload URL:', uploadUrl);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', uploadUrl);
            xhr.timeout = 30000;
            xhr.onload = function () {
                console.log('[html2article] upload HTTP status:', xhr.status);
                console.log('[html2article] upload response:', xhr.responseText);
                try {
                    const resp = JSON.parse(xhr.responseText);
                    console.log('[html2article] upload parsed:', JSON.stringify(resp));
                    if (resp.base_resp && resp.base_resp.ret === 0 && (resp.cdn_url || resp.content)) {
                        resolve(resp.cdn_url || resp.content);
                    } else {
                        console.log('[html2article] upload failed: ret=', resp.base_resp?.ret, 'content=', resp.content, 'cdn_url=', resp.cdn_url);
                        resolve(null);
                    }
                } catch (e) {
                    console.log('[html2article] upload JSON parse error:', e.message);
                    resolve(null);
                }
            };
            xhr.onerror = function () {
                console.log('[html2article] upload XHR error');
                resolve(null);
            };
            xhr.ontimeout = function () {
                console.log('[html2article] upload XHR timeout');
                resolve(null);
            };
            xhr.send(fd);
        } catch (e) {
            console.log('[html2article] upload exception:', e.message);
            resolve(null);
        }
    });
}

function injectHTMLToWeChat(code) {
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));

    const isTitle = (el) => {
        const id = el.id.toLowerCase();
        const cls = (typeof el.className === 'string') ? el.className.toLowerCase() : '';
        const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '').toLowerCase();
        return id.includes('title') || cls.includes('title') || ph.includes('标题');
    };

    let editor = editables.find(el => {
        if (isTitle(el)) return false;
        const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '');
        return ph.includes('正文');
    });

    if (!editor) {
        editor = editables.find(el => {
            if (isTitle(el)) return false;
            const id = el.id.toLowerCase();
            const cls = (typeof el.className === 'string') ? el.className.toLowerCase() : '';
            return id.includes('body') || id.includes('content')
                || cls.includes('edui-body') || cls.includes('body-container')
                || cls.includes('editor_content');
        });
    }

    if (!editor) {
        const candidates = editables.filter(el => !isTitle(el) && el.clientHeight > 0);
        if (candidates.length > 0) {
            editor = candidates.reduce((max, el) => el.clientHeight > max.clientHeight ? el : max);
        }
    }

    if (!editor || editor.clientHeight === 0) return false;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = code;
    wrapper.querySelectorAll('[style]').forEach(el => {
        el.style.removeProperty('text-indent');
    });
    wrapper.querySelectorAll('p, div, span, li').forEach(el => {
        if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
            el.firstChild.textContent = el.firstChild.textContent.replace(/^[\s　\xa0]+/, '');
        }
    });

    editor.insertAdjacentHTML('afterbegin', wrapper.innerHTML);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}
