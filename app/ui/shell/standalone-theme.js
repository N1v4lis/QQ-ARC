// Local auxiliary pages follow the console skin and brightness, including open tabs.
(function(){
 const root=document.documentElement;
 function sync(){
  try{
   root.dataset.skin=localStorage.getItem('qqa-skin')==='minecraft'?'minecraft':'default';
   root.dataset.theme=(localStorage.getItem('qqa-theme-pref')||localStorage.getItem('qqa-theme'))==='dark'?'dark':'light';
   root.dataset.mcFont='on';root.dataset.motion=root.dataset.skin==='minecraft'&&localStorage.getItem('qqa-motion')==='off'?'off':'on';
   root.classList.toggle('dark',root.dataset.theme==='dark');root.classList.toggle('light',root.dataset.theme==='light');
  }catch{}
 }
 sync();window.addEventListener('storage',sync);
})();
