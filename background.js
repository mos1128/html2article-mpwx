const FETCH_TIMEOUT = 15000;

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

async function fetchImage(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
        console.log('[html2article] background fetching:', url);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        console.log('[html2article] background fetch status:', resp.status, 'type:', resp.headers.get('Content-Type'));

        if (!resp.ok) {
            return { success: false, error: `HTTP ${resp.status}` };
        }

        const contentType = resp.headers.get('Content-Type') || 'application/octet-stream';
        const buffer = await resp.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        const dataUrl = `data:${contentType};base64,${base64}`;
        console.log('[html2article] background fetch OK, size:', buffer.byteLength, 'bytes');

        return { success: true, dataUrl, mimeType: contentType };
    } catch (err) {
        clearTimeout(timer);
        const msg = err.name === 'AbortError' ? '下载超时' : err.message;
        console.log('[html2article] background fetch FAILED:', url, msg);
        return { success: false, error: msg };
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'fetchImage') return;
    fetchImage(msg.url).then(sendResponse);
    return true;
});
