
// ── 大肥鱼群二维码：点任意位置关闭 ──
(function () {
  document.getElementById('groupQrBtn').addEventListener('click', function () {
    const ov = document.createElement('div');
    ov.className = 'qr-overlay';
    ov.innerHTML = '<img src="group-qrcode.jpg" alt="大肥鱼群二维码" />';
    ov.addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
  });
})();
