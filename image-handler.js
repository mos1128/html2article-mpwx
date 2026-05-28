function extractFilename(src) {
    const normalized = src.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
}

function classifyImages(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const images = Array.from(doc.querySelectorAll('img'));
    const result = { skip: [], remote: [], local: [], dataUrl: [] };

    for (const img of images) {
        const src = img.getAttribute('src');
        if (!src) continue;

        if (src.startsWith('data:')) {
            const match = src.match(/^data:(image\/[^;]+)/);
            result.dataUrl.push({ originalSrc: src, mimeType: match ? match[1] : 'image/png' });
        } else if (/^https?:\/\//.test(src)) {
            if (src.includes('mmbiz.qpic.cn')) {
                result.skip.push({ originalSrc: src });
            } else {
                result.remote.push({ originalSrc: src });
            }
        } else {
            result.local.push({ originalSrc: src, filename: extractFilename(src) });
        }
    }

    return result;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceImageUrls(html, urlMap, failedSrcs) {
    let result = html;

    for (const [originalSrc, cdnUrl] of urlMap) {
        const escaped = escapeRegex(originalSrc);
        result = result.replace(
            new RegExp(`(src\\s*=\\s*["'])${escaped}(["'])`, 'g'),
            `$1${cdnUrl}$2`
        );
    }

    for (const src of failedSrcs) {
        const escaped = escapeRegex(src);
        result = result.replace(
            new RegExp(`<img[^>]*src\\s*=\\s*["']${escaped}["'][^>]*>`, 'g'),
            ''
        );
    }

    return result;
}

function fetchImageViaBackground(url) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'fetchImage', url }, (resp) => {
            if (chrome.runtime.lastError || !resp) {
                resolve({ success: false, error: chrome.runtime.lastError?.message || '无响应' });
            } else {
                resolve(resp);
            }
        });
    });
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            const match = dataUrl.match(/^data:(image\/[^;]+)/);
            resolve({ dataUrl, mimeType: match ? match[1] : file.type || 'image/png' });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}

async function processImages(html, tabId, localFileMap, onProgress) {
    const classified = classifyImages(html);

    const total =
        classified.remote.length +
        classified.local.length +
        classified.dataUrl.length;

    if (total === 0) return { html, uploaded: 0, failed: 0, total: 0 };

    console.log('[html2article] processImages: remote=' + classified.remote.length +
        ' local=' + classified.local.length + ' dataUrl=' + classified.dataUrl.length);

    const urlMap = new Map();
    const failedSrcs = [];
    let done = 0;
    let failed = 0;

    const uploadOne = async (dataUrl, mimeType, originalSrc) => {
        try {
            const cdnUrl = await uploadImageToWeChatCDN(tabId, dataUrl, mimeType);
            console.log('[html2article] upload:', originalSrc, cdnUrl ? '-> ' + cdnUrl : 'FAILED (CDN returned null)');
            if (cdnUrl) {
                urlMap.set(originalSrc, cdnUrl);
            } else {
                failedSrcs.push(originalSrc);
                failed++;
            }
        } catch {
            failedSrcs.push(originalSrc);
            failed++;
        }
        done++;
        onProgress(done, total);
    };

    // 处理远程图片
    for (const item of classified.remote) {
        const result = await fetchImageViaBackground(item.originalSrc);
        console.log('[html2article] download remote:', item.originalSrc, result.success ? 'OK' : 'FAIL: ' + result.error);
        if (result.success) {
            await uploadOne(result.dataUrl, result.mimeType, item.originalSrc);
        } else {
            failedSrcs.push(item.originalSrc);
            failed++;
            done++;
            onProgress(done, total);
        }
    }

    // 处理本地图片（从 localFileMap 匹配）
    for (const item of classified.local) {
        const fileData = localFileMap.get(item.filename);
        console.log('[html2article] local match:', item.filename, fileData ? 'FOUND' : 'NOT FOUND in localFileMap');
        if (fileData) {
            await uploadOne(fileData.dataUrl, fileData.mimeType, item.originalSrc);
        } else {
            failedSrcs.push(item.originalSrc);
            failed++;
            done++;
            onProgress(done, total);
        }
    }

    // 处理 data: URL 图片
    for (const item of classified.dataUrl) {
        await uploadOne(item.originalSrc, item.mimeType, item.originalSrc);
    }

    const finalHtml = replaceImageUrls(html, urlMap, failedSrcs);
    console.log('[html2article] final: uploaded=' + urlMap.size + ' failed=' + failed + ' total=' + total);
    return { html: finalHtml, uploaded: urlMap.size, failed, total };
}

function uploadImageToWeChatCDN(tabId, dataUrl, mimeType) {
    return new Promise((resolve) => {
        chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: uploadImageInPageContext,
            args: [dataUrl, mimeType]
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) {
                resolve(null);
            } else {
                resolve(results[0].result || null);
            }
        });
    });
}
