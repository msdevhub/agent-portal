/* ═══════════════════════════════════════
   Ottor's Research Lab — Column Engine v4
   ═══════════════════════════════════════ */

const API = '/api';

const STAGES = [
  { id:'question',   label:'提问', icon:'❓' },
  { id:'literature', label:'文献', icon:'📚' },
  { id:'hypothesis', label:'假设', icon:'🤔' },
  { id:'poc',        label:'POC',  icon:'💻' },
  { id:'conclusion', label:'结论', icon:'📊' },
  { id:'report',     label:'报告', icon:'📝' },
];

const STATUS_LABEL = { active:'进行中', paused:'暂停', completed:'完成', archived:'归档', pending:'待办', in_progress:'进行中', done:'完成', blocked:'阻塞' };
const NOTE_TYPE = { finding:'🔍 发现', decision:'🎯 决策', blocker:'🚧 阻塞', idea:'💡 想法' };

const WORK_QUOTES = [
  '研究中...', '写代码', '思考...', '分析数据', '翻文献', '测试中', '记笔记', '画图表',
];

let projects = [];

const $ = id => document.getElementById(id);
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function api(p, m = 'GET', b = null) {
  const o = { method: m };
  if (b) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(b); }
  const r = await fetch(API + p, o);
  return r.json();
}

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await fetch(API + '/init-db', { method: 'POST' });
  await reload();
});

async function reload() {
  await loadStats();
  const list = await api('/projects');
  projects = await Promise.all(list.map(p => api(`/projects/${p.slug}`)));
  renderLanes();
}

async function loadStats() {
  const s = await api('/stats');
  $('s-total').textContent = s.total;
  $('s-active').textContent = s.active;
  $('s-done').textContent = s.completed;
}

// ── Render ──
function renderLanes() {
  const c = $('lanes');
  c.innerHTML = '';

  if (projects.length === 0) {
    c.innerHTML = `
      <div class="empty-lanes">
        <span class="big-icon">📭</span>
        <div style="font-size:18px">还没有研究项目</div>
        <button class="hud-btn" onclick="showCreateProject()">✨ 创建第一个</button>
      </div>`;
    return;
  }

  projects.forEach(p => {
    const lane = document.createElement('div');
    lane.className = `lane ${p.status}`;

    // Header
    const head = document.createElement('div');
    head.className = 'lane-head';
    head.onclick = () => openProjectDrawer(p);
    head.innerHTML = `
      <span class="lane-emoji">${p.emoji || '🔬'}</span>
      <div class="lane-name">${esc(p.name)}</div>
      <span class="lane-status ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>`;
    lane.appendChild(head);

    // Stages
    const stagesDiv = document.createElement('div');
    stagesDiv.className = 'lane-stages';
    const stageIdx = STAGES.findIndex(s => s.id === p.stage);
    const isCompleted = p.status === 'completed';

    STAGES.forEach((s, i) => {
      const cell = document.createElement('div');
      cell.className = 'stage-cell';

      if (isCompleted) {
        cell.classList.add('is-done-stage');
      } else if (i < stageIdx) {
        cell.classList.add('is-done-stage');
      } else if (i === stageIdx) {
        cell.classList.add('is-current');
      } else {
        cell.classList.add('is-future');
      }

      // Label
      const label = document.createElement('div');
      label.className = 'stage-label';
      label.innerHTML = `<span class="stage-icon">${s.icon}</span> ${s.label}`;
      cell.appendChild(label);

      // Tasks in this stage
      const stageTasks = (p.tasks || []).filter(t => t.stage === s.id);
      if (stageTasks.length > 0) {
        const outputs = document.createElement('div');
        outputs.className = 'stage-outputs';
        stageTasks.forEach(t => {
          const chip = document.createElement('div');
          let cls = 'output-chip';
          if (t.status === 'done') cls += ' chip-done';
          else if (t.status === 'blocked') cls += ' chip-blocked';
          else if (t.status === 'in_progress') cls += ' chip-in_progress';
          chip.className = cls;
          chip.textContent = (t.status === 'done' ? '✓ ' : t.status === 'in_progress' ? '▸ ' : '') + t.title;
          chip.title = `${t.title} — ${STATUS_LABEL[t.status]}`;
          chip.onclick = (e) => { e.stopPropagation(); openTaskDetail(p, t); };
          outputs.appendChild(chip);
        });
        cell.appendChild(outputs);
      }

      // Notes indicator in current stage
      if (i === stageIdx && p.notes && p.notes.length > 0 && !isCompleted) {
        let outputs = cell.querySelector('.stage-outputs');
        if (!outputs) {
          outputs = document.createElement('div');
          outputs.className = 'stage-outputs';
          cell.appendChild(outputs);
        }
        const nc = document.createElement('div');
        nc.className = 'output-chip chip-note';
        nc.textContent = `📝 ${p.notes.length}条笔记`;
        nc.onclick = (e) => { e.stopPropagation(); openProjectDrawer(p); };
        outputs.appendChild(nc);
      }

      // Character — only in current stage of active projects
      if (i === stageIdx && p.status === 'active') {
        const quote = WORK_QUOTES[Math.floor(Math.random() * WORK_QUOTES.length)];
        const charHtml = `
          <div class="char-sprite">
            <div class="char-pixel">
              <div class="char-eyes-mini"><div class="mini-eye"></div><div class="mini-eye"></div></div>
            </div>
          </div>
          <div class="mini-bubble">${quote}</div>`;
        cell.insertAdjacentHTML('beforeend', charHtml);
      }

      cell.onclick = () => openStageDrawer(p, s.id, i, stageIdx);
      stagesDiv.appendChild(cell);
    });

    lane.appendChild(stagesDiv);
    c.appendChild(lane);
  });
}

// ── Project Drawer ──
function openProjectDrawer(p) {
  $('drawer-title').textContent = `${p.emoji || '🔬'} ${p.name}`;
  
  let html = '';
  if (p.description) html += `<div style="color:var(--dim);margin-bottom:10px;font-size:15px">${esc(p.description)}</div>`;

  // Controls
  const statusOpts = ['active','paused','completed','archived'].map(s =>
    `<option value="${s}" ${s===p.status?'selected':''}>${STATUS_LABEL[s]}</option>`).join('');
  const stageOpts = STAGES.map(s =>
    `<option value="${s.id}" ${s.id===p.stage?'selected':''}>${s.icon} ${s.label}</option>`).join('');

  html += `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <div><label style="font-size:11px;color:var(--dim)">状态</label>
        <select class="m-select" style="width:auto" onchange="updateProject('${p.id}','${p.slug}',{status:this.value})">${statusOpts}</select></div>
      <div><label style="font-size:11px;color:var(--dim)">阶段</label>
        <select class="m-select" style="width:auto" onchange="updateProject('${p.id}','${p.slug}',{stage:this.value})">${stageOpts}</select></div>
    </div>`;

  // Tasks
  html += `<div class="d-section"><div class="d-section-title">📋 任务</div>`;
  let hasTasks = false;
  STAGES.forEach(s => {
    const tasks = (p.tasks||[]).filter(t => t.stage === s.id);
    if (!tasks.length) return;
    hasTasks = true;
    html += `<div style="font-size:12px;color:var(--dim);margin:5px 0 2px">${s.icon} ${s.label}</div>`;
    tasks.forEach(t => {
      html += `
        <div class="d-task">
          <div class="d-check ${t.status==='done'?'on':''}" onclick="toggleTask('${t.id}','${t.status}','${p.slug}')">${t.status==='done'?'✓':''}</div>
          <span class="d-task-text ${t.status==='done'?'done':''}">${esc(t.title)}</span>
          <span class="d-task-del" onclick="delTask('${t.id}','${p.slug}')">×</span>
        </div>`;
    });
  });
  if (!hasTasks) html += '<div style="color:var(--muted);font-size:14px;padding:4px">暂无任务</div>';
  html += `<button class="d-btn" onclick="showAddTask('${p.id}','${p.slug}','${p.stage}')">+ 添加任务</button></div>`;

  // Notes
  html += `<div class="d-section"><div class="d-section-title">📝 笔记</div>`;
  if (p.notes && p.notes.length) {
    p.notes.forEach(n => {
      html += `
        <div class="d-note type-${n.type}">
          <div class="d-note-type">${NOTE_TYPE[n.type]||n.type}</div>
          <div class="d-note-body">${esc(n.content)}</div>
          <div class="d-note-time">${new Date(n.created_at).toLocaleString('zh-CN')}</div>
        </div>`;
    });
  } else {
    html += '<div style="color:var(--muted);font-size:14px;padding:4px">暂无笔记</div>';
  }
  html += `<button class="d-btn" onclick="showAddNote('${p.id}','${p.slug}')">+ 添加笔记</button></div>`;

  $('drawer-body').innerHTML = html;
  $('drawer').style.display = 'flex';
}

// ── Stage Drawer ──
function openStageDrawer(p, stageId, idx, currentIdx) {
  const s = STAGES.find(x => x.id === stageId);
  $('drawer-title').textContent = `${p.emoji||'🔬'} ${p.name} › ${s.icon} ${s.label}`;

  const tasks = (p.tasks||[]).filter(t => t.stage === stageId);
  const isCompleted = p.status === 'completed';
  let state = isCompleted ? '✅ 已完成' : idx < currentIdx ? '✅ 已完成' : idx === currentIdx ? '⚡ 进行中' : '⏳ 未开始';

  let html = `<div style="margin-bottom:10px;font-size:15px;color:var(--dim)">${state}</div>`;

  if (tasks.length) {
    html += `<div class="d-section"><div class="d-section-title">📋 任务</div>`;
    tasks.forEach(t => {
      html += `
        <div class="d-task">
          <div class="d-check ${t.status==='done'?'on':''}" onclick="toggleTask('${t.id}','${t.status}','${p.slug}')">${t.status==='done'?'✓':''}</div>
          <span class="d-task-text ${t.status==='done'?'done':''}">${esc(t.title)}</span>
          <span class="d-task-del" onclick="delTask('${t.id}','${p.slug}')">×</span>
        </div>`;
    });
    html += '</div>';
  } else {
    html += '<div style="color:var(--muted);padding:8px;font-size:14px">此阶段暂无任务</div>';
  }
  html += `<button class="d-btn" onclick="showAddTask('${p.id}','${p.slug}','${stageId}')">+ 添加到此阶段</button>`;

  $('drawer-body').innerHTML = html;
  $('drawer').style.display = 'flex';
}

// ── Task Detail ──
function openTaskDetail(p, t) {
  $('drawer-title').textContent = `📋 ${t.title}`;
  const statusOpts = ['pending','in_progress','done','blocked'].map(s =>
    `<option value="${s}" ${s===t.status?'selected':''}>${STATUS_LABEL[s]}</option>`).join('');

  $('drawer-body').innerHTML = `
    <div style="margin-bottom:6px">
      <label style="font-size:11px;color:var(--dim)">状态</label>
      <select class="m-select" style="width:auto" onchange="updateTask('${t.id}','${p.slug}',{status:this.value})">${statusOpts}</select>
    </div>
    <div style="color:var(--dim);font-size:15px">${esc(t.description||'无描述')}</div>
    <div style="margin-top:10px;font-size:12px;color:var(--muted)">
      阶段: ${STAGES.find(s=>s.id===t.stage)?.icon||''} ${STAGES.find(s=>s.id===t.stage)?.label||t.stage}<br>
      创建: ${new Date(t.created_at).toLocaleString('zh-CN')}
    </div>`;
  $('drawer').style.display = 'flex';
}

function closeDrawer() { $('drawer').style.display = 'none'; }

// ── Actions ──
async function updateProject(id, slug, data) {
  await api(`/projects/${id}`, 'PUT', data);
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}

async function toggleTask(id, cur, slug) {
  await api(`/tasks/${id}`, 'PUT', { status: cur === 'done' ? 'pending' : 'done' });
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}

async function updateTask(id, slug, data) {
  await api(`/tasks/${id}`, 'PUT', data);
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}

async function delTask(id, slug) {
  if (!confirm('删除此任务?')) return;
  await api(`/tasks/${id}`, 'DELETE');
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}

// ── Modals ──
function openModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal-bg').style.display = 'flex';
}
function closeModal() { $('modal-bg').style.display = 'none'; }

function showCreateProject() {
  openModal('✨ 新建研究项目', `
    <label>项目名称</label>
    <input id="inp-name" class="m-input" placeholder="例如: Agentic BI">
    <label>描述</label>
    <textarea id="inp-desc" class="m-input m-textarea" placeholder="研究目标..."></textarea>
    <label>Emoji</label>
    <input id="inp-emoji" class="m-input" value="🔬" style="width:60px">
    <div class="m-actions">
      <button class="m-btn m-btn-go" onclick="doCreate()">创建</button>
      <button class="m-btn" onclick="closeModal()">取消</button>
    </div>`);
  setTimeout(() => $('inp-name')?.focus(), 80);
}

async function doCreate() {
  const name = $('inp-name').value.trim();
  if (!name) return alert('请输入名称');
  await api('/projects', 'POST', {
    name, description: $('inp-desc').value.trim(),
    emoji: $('inp-emoji').value.trim() || '🔬'
  });
  closeModal();
  await reload();
}

function showAddTask(pid, slug, stage) {
  const opts = STAGES.map(s =>
    `<option value="${s.id}" ${s.id===stage?'selected':''}>${s.icon} ${s.label}</option>`).join('');
  openModal('📋 添加任务', `
    <label>标题</label>
    <input id="inp-tt" class="m-input" placeholder="任务描述...">
    <label>阶段</label>
    <select id="inp-ts" class="m-select">${opts}</select>
    <div class="m-actions">
      <button class="m-btn m-btn-go" onclick="doAddTask('${pid}','${slug}')">添加</button>
      <button class="m-btn" onclick="closeModal()">取消</button>
    </div>`);
  setTimeout(() => $('inp-tt')?.focus(), 80);
}

async function doAddTask(pid, slug) {
  const title = $('inp-tt').value.trim();
  if (!title) return alert('请输入标题');
  await api('/tasks', 'POST', { project_id: pid, title, stage: $('inp-ts').value });
  closeModal();
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}

function showAddNote(pid, slug) {
  const opts = ['finding','decision','blocker','idea'].map(t =>
    `<option value="${t}">${NOTE_TYPE[t]}</option>`).join('');
  openModal('📝 添加笔记', `
    <label>类型</label>
    <select id="inp-nt" class="m-select">${opts}</select>
    <label>内容</label>
    <textarea id="inp-nc" class="m-input m-textarea" rows="3" placeholder="记录..."></textarea>
    <div class="m-actions">
      <button class="m-btn m-btn-go" onclick="doAddNote('${pid}','${slug}')">保存</button>
      <button class="m-btn" onclick="closeModal()">取消</button>
    </div>`);
  setTimeout(() => $('inp-nc')?.focus(), 80);
}

async function doAddNote(pid, slug) {
  const content = $('inp-nc').value.trim();
  if (!content) return alert('请输入内容');
  await api('/notes', 'POST', { project_id: pid, content, type: $('inp-nt').value });
  closeModal();
  await reload();
  const p = projects.find(x => x.slug === slug);
  if (p) openProjectDrawer(p);
}
