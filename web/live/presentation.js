// Local SVGs and disclosure feedback. This module does not own session state.
const paths = {
  watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="m9 6 1-4h4l1 4m-6 12 1 4h4l1-4m-3-9v3l2 1"/>',
  scene: '<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10v10M3 7l9 5 9-5M7 5l10 5"/>',
  music: '<path d="M9 18V5l12-3v13M9 8l12-3"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="15" rx="3" ry="3"/>',
  hand: '<path d="M8 12V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 9-11 9-14 4l-4-6a2 2 0 0 1 3-2l3 3"/>',
  movement: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  settings: '<path d="M4 3v18M12 3v18M20 3v18"/><path d="M1 8h6M9 16h6M17 8h6"/>',
  play: '<path d="m7 3 14 9-14 9Z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  record: '<circle cx="12" cy="12" r="7"/>',
  cancel: '<path d="m6 6 12 12M6 18 18 6"/>',
  connect: '<path d="M12 3v18M7 7l10 10-5 4V3l5 4L7 17"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.7', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false', class:'icon'})) svg.setAttribute(key, value);
  svg.innerHTML = paths[name] || paths.play;
  return svg;
}
export function action(button, label, name, accessibleLabel = label) {
  // Avoid replacing focused controls or their contents on every watch refresh.
  if (button.dataset.action !== name + label) {
    button.replaceChildren(icon(name), document.createTextNode(label));
    button.dataset.action = name + label;
  }
  button.setAttribute('aria-label', accessibleLabel);
}
export function initPresentation() {
  document.querySelectorAll('[data-icon]').forEach(el => el.replaceWith(icon(el.dataset.icon)));
  action(document.getElementById('go'), 'Start', 'play');
  action(document.getElementById('rec'), 'Record', 'record');
  action(document.getElementById('tap'), 'Tap for sound', 'music');
  const controls = document.getElementById('sessionControls');
  new ResizeObserver(() => document.querySelector('aside').style.setProperty('--session-height', `${controls.offsetHeight + 12}px`)).observe(controls);
  // Legacy feature renderers report human-readable status. Watch their small
  // status nodes, never the pose meters or the whole document.
  const statuses = [...document.querySelectorAll('.control-section .status, #watchDevices, #sceneControls, #magentaControls')];
  const errors = /failed|could not|unavailable|disconnected|retrying|denied|no microphone|not supported|requires HTTPS|Bluetooth is off/i;
  const alerts = document.getElementById('sectionAlerts');
  function refresh() {
    for (const section of document.querySelectorAll('.control-section')) {
      const issue = [...section.querySelectorAll('.status, [data-issue]')].find(node =>
        !node.closest('[hidden]') && (node.dataset.issue === 'true' || (node.dataset.issue !== 'false' && errors.test(node.textContent))));
      section.querySelector('.section-warning').hidden = !issue;
      let link = alerts.querySelector(`[data-section="${section.id}"]`);
      if (issue && !section.open) {
        if (!link) {
          link = document.createElement('button'); link.type = 'button'; link.className = 'section-alert'; link.dataset.section = section.id;
          link.onclick = () => { section.open = true; section.querySelector('summary').focus(); section.scrollIntoView({block:'nearest'}); };
          alerts.append(link);
        }
        const title = section.querySelector('summary > span').textContent;
        const message = `${title}: ${issue.textContent.trim()} · Open section`;
        if (link.textContent !== message) link.textContent = message;
      } else link?.remove();
    }
  }
  const observer = new MutationObserver(refresh);
  statuses.forEach(el => observer.observe(el, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden', 'data-issue']}));
  document.querySelectorAll('.control-section').forEach(section => section.addEventListener('toggle', refresh));
  refresh();
}
