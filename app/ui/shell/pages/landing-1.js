
  (function () {
    try {
      var t = localStorage.getItem('theme') || 'light';
      var r = document.documentElement;
      r.classList.remove('light', 'dark');
      r.classList.add(t === 'dark' ? 'dark' : 'light');
    } catch (e) { document.documentElement.classList.add('light'); }
  })();
