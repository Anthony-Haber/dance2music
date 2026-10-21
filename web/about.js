(async () => {
  const m = document.getElementById('m');
  m.innerHTML = await (await fetch('methods.html')).text();
  renderMathInElement(m, { delimiters: [{ left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false }], throwOnError: false });
  const el = location.hash && document.getElementById(location.hash.slice(1));
  if (el) { el.classList.add('here'); el.scrollIntoView(); }
})();
