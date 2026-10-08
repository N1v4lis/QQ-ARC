
// 主题包未加载（本地预览）时打标记，启用自带兜底背景
addEventListener('load', function () {
  if (!document.getElementById('th-flow-bg') && !document.getElementById('th-canvas')) {
    document.documentElement.classList.add('no-theme');
  }
});
