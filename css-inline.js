function convertStylesToInline(html) {
    const container = document.createElement('div');
    container.innerHTML = html;

    // 提取所有 <style> 标签的文本内容并移除
    const styleElements = container.querySelectorAll('style');
    const cssTexts = [];
    styleElements.forEach(el => {
        cssTexts.push(el.textContent);
        el.remove();
    });

    if (cssTexts.length === 0) return html;

    // 解析 CSS 规则
    const rules = [];
    for (const cssText of cssTexts) {
        // 按 } 分割，每段是一个 rule block
        const blocks = cssText.split('}');
        for (const block of blocks) {
            const braceIndex = block.indexOf('{');
            if (braceIndex === -1) continue;

            const selector = block.substring(0, braceIndex).trim();
            const declarations = block.substring(braceIndex + 1).trim();
            if (!selector || !declarations) continue;

            // 跳过不支持的选择器
            if (selector.includes('@') || selector.includes(':') || selector.includes('::')) continue;

            try {
                const matched = container.querySelectorAll(selector);
                if (matched.length > 0) {
                    rules.push({ selector, declarations, matched });
                }
            } catch {
                // 选择器语法无效，跳过
            }
        }
    }

    // 将样式应用到匹配元素
    for (const { declarations, matched } of rules) {
        const newStyles = parseDeclarations(declarations);
        matched.forEach(el => {
            const existing = parseDeclarations(el.getAttribute('style') || '');
            // inline style 优先级更高，覆盖同属性
            const merged = { ...newStyles, ...existing };
            el.setAttribute('style', serializeStyles(merged));
        });
    }

    return container.innerHTML;
}

function parseDeclarations(str) {
    const result = {};
    const parts = str.split(';');
    for (const part of parts) {
        const colonIndex = part.indexOf(':');
        if (colonIndex === -1) continue;
        const prop = part.substring(0, colonIndex).trim().toLowerCase();
        const val = part.substring(colonIndex + 1).trim();
        if (prop && val) result[prop] = val;
    }
    return result;
}

function serializeStyles(obj) {
    return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join('; ');
}
