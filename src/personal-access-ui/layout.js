/* The single desktop page assembly. Move components here; feature actions stay in ui-core. */
(() => {
    const markup = globalThis.WeftUiMarkup;
    const page = "\n  <div class=\"page\">\n    <header class=\"site-header\">\n      <div class=\"site-title\"><span class=\"site-name\">WeftMate</span></div>\n      <span class=\"local-badge\" hidden></span>\n    </header>\n\n    <main class=\"main\" id=\"main\">\n      " +
        markup.auth0 +
        "\n\n      " +
        markup.auth1 +
        "\n\n      " +
        markup.auth2 +
        "\n\n      " +
        markup.auth3 +
        "\n\n      " +
        markup.auth4 +
        "\n      <section id=\"assistant-view\" hidden>\n        <div class=\"assistant-shell\">\n          <button type=\"button\" class=\"rail-backdrop\" id=\"rail-backdrop\" aria-label=\"关闭会话侧栏\" hidden></button>\n          " +
        markup.sidebar +
        "\n          <div class=\"assistant-main\">\n            " +
        markup.header +
        "\n            <p class=\"connection-banner\" id=\"connection-banner\" role=\"status\" hidden></p>\n\n            <section class=\"conversation-pane\" id=\"conversation-pane\" aria-label=\"对话\">\n              " +
        markup.timeline +
        "\n              " +
        markup.composer +
        "\n            </section>\n            " +
        markup.phone +
        "\n          </div>\n        </div>\n      </section>\n\n      " +
        markup.memory +
        "\n\n      " +
        markup.settings +
        "\n    </main>\n    <footer class=\"footer\">WeftMate · 织语</footer>\n  </div>\n\n  " +
        markup.dialogs0 +
        "\n\n  " +
        markup.dialogs1 +
        "\n\n  <dialog class=\"dialog memory-detail-dialog\" id=\"memory-detail-dialog\" aria-labelledby=\"memory-detail-title\">\n    <div class=\"dialog-head\"><h2 id=\"memory-detail-title\">记忆详情</h2><button type=\"button\" class=\"icon-close\" id=\"memory-detail-close\" aria-label=\"关闭记忆详情\"><svg class=\"wm-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><use href=\"/personal/v1/ui/icons.svg#deny\"/></svg></button></div>\n    <div class=\"dialog-body\">\n      <p id=\"memory-detail-status\" class=\"memory-detail-status\" role=\"status\"></p>\n      <p id=\"memory-detail-error\" class=\"form-error\" role=\"alert\" hidden></p>\n      <div id=\"memory-detail-body\">\n        <p id=\"memory-detail-text\" class=\"memory-detail-text\"></p>\n        <p id=\"memory-detail-meta\" class=\"muted memory-detail-meta\"></p>\n        <h3>来源</h3><p id=\"memory-sources-status\" class=\"muted\"></p><ul id=\"memory-sources\" class=\"memory-sources\"></ul>\n      </div>\n      <div id=\"memory-correct-panel\" hidden><label for=\"memory-correct-text\">更正说明</label><textarea id=\"memory-correct-text\" rows=\"5\" maxlength=\"4000\" placeholder=\"写明需要更正的内容\"></textarea><p class=\"field-help\">上方原理解只供核对，不会自动填入更正框；更正结果以宿主回执为准。</p></div>\n      <div id=\"memory-confirm-panel\" hidden><p id=\"memory-confirm-copy\"></p><p id=\"memory-delete-boundary\" class=\"field-help\" hidden>删除会从当前账户的有效记忆正文、索引和受影响的派生引用中移除；原 WeftMate 聊天、会话存档、过去备份和文件系统快照仍保留，不在本次范围内。</p></div>\n    </div>\n    <div class=\"dialog-footer memory-detail-actions\"><button type=\"button\" class=\"button secondary\" id=\"memory-detail-back\" hidden>返回详情</button><button type=\"button\" class=\"button secondary\" id=\"memory-detail-check\" hidden>核对处理结果</button><button type=\"button\" class=\"button secondary\" id=\"memory-correct-action\" hidden>纠正</button><button type=\"button\" class=\"button secondary\" id=\"memory-mute-action\" hidden>停用</button><button type=\"button\" class=\"button danger\" id=\"memory-delete-action\" hidden>删除</button><button type=\"button\" class=\"button primary\" id=\"memory-confirm-action\" hidden>确认</button></div>\n  </dialog>\n\n  <p class=\"toast\" id=\"toast\" role=\"status\" aria-live=\"polite\" hidden></p>\n";
    document.body.innerHTML = page;
    globalThis.WeftUiLayout = {
        mountSchedules(section) { document.querySelector('#account-view').prepend(section); },
        mountUsage(button) { document.querySelector('.assistant-heading').append(button); },
        mountPreview(panel) { document.querySelector('.assistant-shell').append(panel); },
        mountResourcePicker(picker) { document.querySelector('.assistant-shell').append(picker); },
    };
    /* layout-test-slot */
})();
