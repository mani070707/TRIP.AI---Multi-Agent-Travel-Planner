'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('trip-form');
  const message = $('trip-message');
  let threadId = null;
  let busy = false;
  let controller = null;
  let requestVersion = 0;

  // Build a safe, presentation-focused subset of Markdown using DOM nodes.
  function inline(parent, text) {
    const pieces = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
    pieces.forEach((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.append(strong);
      } else if (part.startsWith('*') && part.endsWith('*')) {
        const emphasis = document.createElement('em');
        emphasis.textContent = part.slice(1, -1);
        parent.append(emphasis);
      } else if (/^\[[^\]]+\]\(https?:\/\//.test(part)) {
        const match = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (!match) { parent.append(document.createTextNode(part)); return; }
        const anchor = document.createElement('a');
        anchor.textContent = match[1];
        anchor.href = match[2];
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'source-link';
        parent.append(anchor);
      } else parent.append(document.createTextNode(part));
    });
  }
  function tableRow(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  }
  function renderText(container, value) {
    container.replaceChildren();
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '';
    const lines = text.split(/\r?\n/);
    let list = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) { list = null; continue; }
      if (/^\s*-{3,}\s*$/.test(line)) {
        list = null; container.append(document.createElement('hr')); continue;
      }
      if (line.trim().startsWith('|') && lines[index + 1] && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
        list = null;
        const wrapper = document.createElement('div'); wrapper.className = 'table-scroll';
        const table = document.createElement('table');
        const head = document.createElement('thead'); const headRow = document.createElement('tr');
        tableRow(line).forEach(cell => { const th = document.createElement('th'); inline(th, cell); headRow.append(th); });
        head.append(headRow); table.append(head);
        const body = document.createElement('tbody'); index += 2;
        while (index < lines.length && lines[index].trim().startsWith('|')) {
          const row = document.createElement('tr');
          tableRow(lines[index]).forEach(cell => { const td = document.createElement('td'); inline(td, cell); row.append(td); });
          body.append(row); index += 1;
        }
        index -= 1; table.append(body); wrapper.append(table); container.append(wrapper); continue;
      }
      const heading = line.match(/^#{1,6}\s+(.+)/);
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)/);
      const quote = line.match(/^\s*>\s*(.+)/);
      if (bullet) {
        const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (!list || list.tagName.toLowerCase() !== type) {
          list = document.createElement(type);
          if (type === 'ol') list.start = Number(line.trim().match(/^\d+/)[0]);
          container.append(list);
        }
        const item = document.createElement('li');
        inline(item, bullet[1]); list.append(item);
      } else if (quote) {
        list = null;
        const element = document.createElement('blockquote'); inline(element, quote[1]); container.append(element);
      } else {
        list = null;
        const element = document.createElement(heading ? 'h3' : 'p');
        inline(element, heading ? heading[1] : line); container.append(element);
      }
    }
  }
  const agentMeta = {
    flight_agent: ['Flight agent', 'Routes & fares'],
    hotel_agent: ['Hotel agent', 'Hotels & sources'],
    weather_agent: ['Weather agent', 'Conditions & advice'],
    budget_agent: ['Budget agent', 'Cost & feasibility'],
    itinerary_agent: ['Itinerary agent', 'Plan synthesis'],
    guardrail_blocked: ['Guardrail', 'Request validation']
  };
  function renderAgentFlow(data, blocked) {
    const flow = $('agent-flow'); flow.replaceChildren();
    const agents = blocked ? ['guardrail_blocked'] : (Array.isArray(data.selected_agents) ? data.selected_agents : []);
    const makeNode = (name, role, orderNumber, className = '') => {
      const node = document.createElement('div'); node.className = `agent-node ${className}`.trim();
      const order = document.createElement('span'); order.className = 'agent-order'; order.textContent = String(orderNumber).padStart(2, '0');
      const copy = document.createElement('span'); const title = document.createElement('strong'); const detail = document.createElement('small');
      title.textContent = name; detail.textContent = role; copy.append(title, detail); node.append(order, copy); flow.append(node);
      return node;
    };

    const supervisorRow = document.createElement('div'); supervisorRow.className = 'supervisor-row';
    const supervisorNode = makeNode('Supervisor agent', 'Intent, guardrails & routing', 1, 'supervisor-node');
    supervisorRow.append(supervisorNode);
    const connector = document.createElement('span'); connector.className = 'supervisor-connector'; connector.setAttribute('aria-hidden', 'true');
    flow.append(supervisorRow, connector);

    const specialistRow = document.createElement('div'); specialistRow.className = 'specialist-flow';
    agents.forEach((name, index) => {
      if (index) { const arrow = document.createElement('span'); arrow.className = 'flow-arrow'; arrow.textContent = '→'; arrow.setAttribute('aria-hidden', 'true'); specialistRow.append(arrow); }
      const [title, role] = agentMeta[name] || [name.replaceAll('_', ' '), 'Specialist agent'];
      const node = makeNode(title, role, index + 2);
      specialistRow.append(node);
    });
    flow.append(specialistRow);
    const reasoning = typeof data.supervisor_reasoning === 'string' ? data.supervisor_reasoning.trim() : '';
    $('supervisor-reasoning').textContent = reasoning ? `Supervisor decision: ${reasoning}` : 'The supervisor validated the request and selected the agents needed for this journey.';
  }
  function setBusy(value, title = 'Putting your journey together') {
    busy = value;
    $('loading').hidden = !value;
    $('loading-title').textContent = title;
    $('results').setAttribute('aria-busy', String(value));
    document.querySelectorAll('#trip-form button, #trip-form textarea, .suggestion, #review button, #review textarea').forEach(el => { el.disabled = value; });
    $('plan-button').textContent = value ? 'Working on it…' : 'Plan my trip ↗';
  }
  function showError(text) { $('error').textContent = text; $('error').hidden = false; }
  function showResult(data) {
    const blocked = data.guardrail_allowed === false;
    threadId = data.thread_id || null;
    $('results').hidden = false;
    $('result-title').textContent = blocked ? 'Let’s rethink this trip' : data.requires_approval ? 'Your journey, first draft.' : 'Your journey, thoughtfully planned.';
    $('result-badge').textContent = blocked ? 'Needs another look' : data.requires_approval ? 'Ready to review' : 'Your itinerary';
    renderAgentFlow(data, blocked);
    renderText($('answer'), blocked ? data.guardrail_reason || data.answer : data.answer || data.itinerary || 'No itinerary was returned. Please try describing your trip again.');
    $('review').hidden = blocked || !data.requires_approval || !threadId;
    $('approval-copy').textContent = data.approval_request || 'Take a look around your itinerary. Approve it, or tell us what you’d like to change.';
    $('feedback-form').hidden = true;
    $('request-changes').setAttribute('aria-expanded', 'false');
    $('feedback').value = '';
    if (data.requires_approval && !threadId && !blocked) showError('The draft is missing its review session. Please plan your trip again to enable approval.');
    $('result-title').focus({preventScroll: true});
    $('results').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
  }
  async function send(url, payload, title) {
    if (busy) return;
    const version = ++requestVersion;
    controller = new AbortController();
    const signal = controller.signal;
    $('error').hidden = true;
    setBusy(true, title);
    try {
      const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal});
      let data;
      try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Please try again.'); }
      if (!response.ok || data.success !== true) throw new Error(typeof data.error === 'string' ? data.error : 'We couldn’t complete that request. Please try again.');
      if (version !== requestVersion) return;
      showResult(data);
    } catch (error) {
      if (version !== requestVersion || signal.aborted) return;
      showError(error instanceof TypeError ? 'We couldn’t reach the travel planner. Check your connection and try again. Your details are still here.' : error.message);
    } finally {
      if (version === requestVersion) { controller = null; setBusy(false); }
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!message.value.trim()) { showError('Tell us a little about the trip you have in mind.'); message.focus(); return; }
    // Each new planning submission starts a fresh run; only review resumes a thread.
    send('/api/travel', {message: message.value.trim(), thread_id: null});
  });
  document.querySelectorAll('.suggestion').forEach(button => button.addEventListener('click', () => { message.value = button.dataset.prompt; message.focus(); }));
  $('approve').addEventListener('click', () => { if (threadId) send('/api/travel/approve', {thread_id: threadId, approved: true, feedback: ''}, 'Finishing your itinerary'); });
  $('request-changes').addEventListener('click', () => { $('feedback-form').hidden = false; $('request-changes').setAttribute('aria-expanded', 'true'); $('feedback').focus(); });
  $('feedback-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('feedback').value.trim()) { showError('Add a few details about what you’d like to change.'); $('feedback').focus(); return; }
    if (threadId) send('/api/travel/approve', {thread_id: threadId, approved: false, feedback: $('feedback').value.trim()}, 'Refining your itinerary');
  });
  $('new-trip').addEventListener('click', () => {
    requestVersion++;
    if (controller) controller.abort();
    controller = null; threadId = null; setBusy(false);
    form.reset(); $('feedback-form').reset();
    ['results', 'error', 'review', 'feedback-form'].forEach(id => { $(id).hidden = true; });
    $('answer').replaceChildren(); $('agent-flow').replaceChildren();
    $('request-changes').setAttribute('aria-expanded', 'false'); message.focus();
  });
})();
