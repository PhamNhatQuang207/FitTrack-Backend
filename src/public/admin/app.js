const TOKEN_KEY = 'fittrack_admin_token';
const USER_KEY = 'fittrack_admin_username';
let exercisesCache = [];
let groupsCache = [];
let feedbacksCache = [];
let toastTimer = null;

const $ = (id) => document.getElementById(id);

const showToast = (msg) => {
  const el = $('toast');
  el.textContent = `// ${msg}`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
};

const apiFetch = async (url, options = {}) => {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
};

const updateFeedbackStats = () => {
  const total = feedbacksCache.length;
  const pending = feedbacksCache.filter((f) => f.status === 'pending').length;
  const totalEl = $('stat-total-feedbacks');
  const pendingEl = $('stat-pending-feedbacks');
  if (totalEl) totalEl.textContent = total;
  if (pendingEl) {
    pendingEl.textContent = `${pending} PENDING`;
    pendingEl.className = pending > 0 ? 'badge-orange' : 'badge-lime';
  }
};

const updateKpiStats = () => {
  const totalEx = exercisesCache.length;
  const activeEx = exercisesCache.filter((e) => e.isActive !== false).length;
  $('stat-total-exercises').textContent = totalEx;
  $('stat-active-exercises').textContent = `${activeEx} ACTIVE`;

  const totalGrp = groupsCache.length;
  const activeGrp = groupsCache.filter((g) => g.isActive !== false).length;
  $('stat-total-groups').textContent = totalGrp;
  $('stat-active-groups').textContent = `${activeGrp} ENABLED`;

  updateFeedbackStats();
};

const showDashboard = async () => {
  $('login-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  $('admin-username-label').textContent = sessionStorage.getItem(USER_KEY) || 'ADMIN';
  await Promise.all([loadGroups(), loadExercises(), loadSiteConfig(), loadFeedbacks()]);
  updateKpiStats();
};

const showLogin = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  $('dashboard-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
};

const populateGroupSelects = () => {
  const activeGroups = groupsCache.filter((g) => g.isActive !== false);

  // Exercise form category select
  const exCat = $('ex-category');
  const prevCat = exCat.value;
  exCat.innerHTML = '';
  activeGroups.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.name;
    exCat.appendChild(opt);
  });
  if (prevCat) exCat.value = prevCat;

  // Filter bar category select
  const filterCat = $('exercise-category-filter');
  const prevFilter = filterCat.value;
  filterCat.innerHTML = '<option value="">All Muscle Groups</option>';
  groupsCache.forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.name;
    filterCat.appendChild(opt);
  });
  filterCat.value = prevFilter;

  // Merge source & target selects
  const srcSelect = $('merge-source');
  const tgtSelect = $('merge-target');
  srcSelect.innerHTML = '';
  tgtSelect.innerHTML = '';
  groupsCache.forEach((g) => {
    const o1 = document.createElement('option');
    o1.value = g.id;
    o1.textContent = g.name;
    srcSelect.appendChild(o1);

    const o2 = document.createElement('option');
    o2.value = g.id;
    o2.textContent = g.name;
    tgtSelect.appendChild(o2);
  });
  if (groupsCache.length > 1) {
    tgtSelect.selectedIndex = 1;
  }
  syncAllCustomSelects();
};

const appendNameWithViBadge = (cell, name, hasVi) => {
  const nameSpan = document.createElement('span');
  nameSpan.textContent = name;
  const badge = document.createElement('span');
  badge.className = `badge-vi${hasVi ? ' is-translated' : ''}`;
  badge.textContent = hasVi ? 'VI ✓' : 'VI —';
  cell.append(nameSpan, badge);
};

const renderGroups = () => {
  const tbody = $('groups-tbody');
  tbody.innerHTML = '';

  const countsByCat = {};
  exercisesCache.forEach((ex) => {
    countsByCat[ex.category] = (countsByCat[ex.category] || 0) + 1;
  });

  groupsCache.forEach((g) => {
    const tr = document.createElement('tr');
    const count = countsByCat[g.name] || 0;
    const hasVi = Boolean(g.translations?.vi?.name?.trim());
    tr.innerHTML = `
      <td class="ex-name-cell"></td>
      <td><span class="mono-meta"></span></td>
      <td><span class="mono-meta">${count} EXERCISES</span></td>
      <td class="text-center"><span class="${g.isActive ? 'badge-lime' : 'badge-orange'}">${g.isActive ? 'ACTIVE' : 'HIDDEN'}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="ft-btn-secondary btn-sm edit-grp">Rename / Edit</button>
          <button type="button" class="ft-btn-ghost btn-sm toggle-grp">${g.isActive ? 'Hide' : 'Restore'}</button>
        </div>
      </td>
    `;
    appendNameWithViBadge(tr.children[0], g.name, hasVi);
    tr.children[1].firstChild.textContent = g.slug;

    tr.querySelector('.edit-grp').addEventListener('click', () => {
      $('grp-id').value = g.id;
      $('grp-name').value = g.name;
      $('grp-name-vi').value = g.translations?.vi?.name || '';
      $('grp-icon').value = g.iconUrl || '';
      $('group-form-title').textContent = `Rename: ${g.name}`;
      $('grp-submit-btn').textContent = 'Update & Sync 5 Collections';
      $('grp-name').focus();
    });

    tr.querySelector('.toggle-grp').addEventListener('click', async () => {
      await apiFetch(`/api/admin/muscle-groups/${g.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !g.isActive }),
      });
      showToast(`${g.name} ${g.isActive ? 'hidden' : 'restored'}`);
      await loadGroups();
      updateKpiStats();
    });

    tbody.appendChild(tr);
  });
};

const loadGroups = async () => {
  groupsCache = await apiFetch('/api/admin/muscle-groups');
  populateGroupSelects();
  renderGroups();
};

const renderExercises = () => {
  const q = $('exercise-search').value.trim().toLowerCase();
  const catFilter = $('exercise-category-filter').value;
  const statusFilter = $('exercise-status-filter').value;
  const tbody = $('exercises-tbody');
  tbody.innerHTML = '';

  const filtered = exercisesCache.filter((ex) => {
    const active = ex.isActive !== false;
    if (catFilter && ex.category !== catFilter) return false;
    if (statusFilter === 'active' && !active) return false;
    if (statusFilter === 'hidden' && active) return false;
    const viName = ex.translations?.vi?.name?.toLowerCase() || '';
    if (q && !ex.name.toLowerCase().includes(q) && !ex.category.toLowerCase().includes(q) && !viName.includes(q)) return false;
    return true;
  });

  $('exercise-count-label').textContent = `SHOWING ${filtered.length} OF ${exercisesCache.length} EXERCISES`;

  filtered.forEach((ex) => {
    const tr = document.createElement('tr');
    const active = ex.isActive !== false;
    const hasVi = Boolean(ex.translations?.vi?.name?.trim());
    tr.innerHTML = `
      <td class="ex-name-cell"></td>
      <td class="text-center"><span class="badge-gray"></span></td>
      <td class="mono-meta"></td>
      <td class="text-center"><span class="${active ? 'badge-lime' : 'badge-orange'}">${active ? 'ACTIVE' : 'HIDDEN'}</span></td>
      <td>
        <div class="row-actions">
          <button type="button" class="ft-btn-secondary btn-sm edit-btn">Edit</button>
          <button type="button" class="ft-btn-ghost btn-sm toggle-btn">${active ? 'Hide' : 'Restore'}</button>
        </div>
      </td>
    `;
    appendNameWithViBadge(tr.children[0], ex.name, hasVi);
    tr.children[1].firstChild.textContent = ex.category;
    tr.children[2].textContent = ex.equipment || 'STANDARD';
    tr.querySelector('.edit-btn').addEventListener('click', () => openEditForm(ex));
    tr.querySelector('.toggle-btn').addEventListener('click', () => toggleStatus(ex.id, !active));
    tbody.appendChild(tr);
  });
};

const loadExercises = async () => {
  exercisesCache = await apiFetch('/api/admin/exercises');
  renderExercises();
  renderGroups();
};

const openEditForm = (ex = null) => {
  $('exercise-form').classList.remove('hidden');
  $('exercise-form-title').textContent = ex ? `Edit: ${ex.name}` : 'New Exercise';
  $('ex-id').value = ex ? ex.id : '';
  $('ex-name').value = ex ? ex.name : '';
  $('ex-name-vi').value = ex?.translations?.vi?.name || '';
  if (ex && ex.category) $('ex-category').value = ex.category;
  $('ex-muscle').value = ex ? (ex.muscleGroup || '') : '';
  $('ex-equipment').value = ex ? (ex.equipment || '') : '';
  $('ex-difficulty').value = ex ? (ex.difficulty || 'Beginner') : 'Beginner';
  $('ex-image').value = ex ? (ex.imageUrl || '') : '';
  $('ex-instructions').value = ex && Array.isArray(ex.instructions) ? ex.instructions.join('\n') : '';
  $('ex-instructions-vi').value = Array.isArray(ex?.translations?.vi?.instructions)
    ? ex.translations.vi.instructions.join('\n')
    : '';
  syncAllCustomSelects();
  $('ex-name').focus();
};

const toggleStatus = async (id, isActive) => {
  await apiFetch(`/api/admin/exercises/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  showToast(isActive ? 'Exercise restored to catalogue' : 'Exercise hidden from catalogue');
  await loadExercises();
  updateKpiStats();
};

const loadSiteConfig = async () => {
  const cfg = await apiFetch('/api/site-config');
  $('cfg-hero-bg').value = cfg.heroBackgroundUrl || '';
  $('cfg-banner').value = cfg.announcementBanner || '';
  $('cfg-note').value = cfg.featuredNote || '';
  updatePreview();
};

const updatePreview = () => {
  const url = $('cfg-hero-bg').value.trim();
  const banner = $('cfg-banner').value.trim();
  const note = $('cfg-note').value.trim();
  const img = $('cfg-hero-preview');
  const bannerEl = $('preview-banner');

  if (url) {
    img.src = url;
    img.classList.remove('hidden');
    $('stat-bg-mode').textContent = 'CUSTOM';
  } else {
    img.classList.add('hidden');
    $('stat-bg-mode').textContent = 'DEFAULT';
  }

  if (banner) {
    bannerEl.textContent = banner;
    bannerEl.classList.remove('hidden');
    $('stat-banner-mode').textContent = 'LIVE BANNER';
    $('stat-banner-mode').className = 'badge-lime';
  } else {
    bannerEl.classList.add('hidden');
    $('stat-banner-mode').textContent = 'NO BANNER';
    $('stat-banner-mode').className = 'badge-orange';
  }

  $('preview-note').textContent = note || 'Default FitTrack dark cyber-grid background active.';
};

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('login-error');
  errEl.classList.add('hidden');
  try {
    const data = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('login-username').value,
        password: $('login-password').value,
      }),
    });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, data.username || 'ADMIN');
    await showDashboard();
    showToast('Operator session initialized');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

$('logout-btn').addEventListener('click', showLogin);
$('exercise-search').addEventListener('input', renderExercises);
$('exercise-category-filter').addEventListener('change', renderExercises);
$('exercise-status-filter').addEventListener('change', renderExercises);
$('new-exercise-btn').addEventListener('click', () => openEditForm(null));
$('cancel-exercise-btn').addEventListener('click', () => $('exercise-form').classList.add('hidden'));

$('exercise-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('ex-id').value;
  const payload = {
    name: $('ex-name').value,
    category: $('ex-category').value,
    muscleGroup: $('ex-muscle').value,
    equipment: $('ex-equipment').value,
    difficulty: $('ex-difficulty').value,
    imageUrl: $('ex-image').value,
    instructions: $('ex-instructions').value.split('\n').map((s) => s.trim()).filter(Boolean),
    translations: {
      vi: {
        name: $('ex-name-vi').value.trim(),
        instructions: $('ex-instructions-vi').value.split('\n').map((s) => s.trim()).filter(Boolean),
      },
    },
  };

  if (id) {
    await apiFetch(`/api/admin/exercises/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Exercise updated');
  } else {
    await apiFetch('/api/admin/exercises', { method: 'POST', body: JSON.stringify(payload) });
    showToast('New exercise added to catalogue');
  }
  $('exercise-form').classList.add('hidden');
  await loadExercises();
  updateKpiStats();
});

const resetGroupForm = () => {
  $('grp-id').value = '';
  $('grp-name').value = '';
  $('grp-name-vi').value = '';
  $('grp-icon').value = '';
  $('group-form-title').textContent = 'Add / Rename Muscle Group';
  $('grp-submit-btn').textContent = 'Save Muscle Group';
};

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('grp-id').value;
  const payload = {
    name: $('grp-name').value,
    iconUrl: $('grp-icon').value,
    translations: {
      vi: {
        name: $('grp-name-vi').value.trim(),
      },
    },
  };
  if (id) {
    await apiFetch(`/api/admin/muscle-groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    showToast('Muscle group renamed & synced across 5 collections');
  } else {
    await apiFetch('/api/admin/muscle-groups', { method: 'POST', body: JSON.stringify(payload) });
    showToast('New muscle group created');
  }
  resetGroupForm();
  await Promise.all([loadGroups(), loadExercises()]);
  updateKpiStats();
});

$('cancel-group-btn').addEventListener('click', resetGroupForm);

$('merge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sourceId = $('merge-source').value;
  const targetId = $('merge-target').value;
  if (!sourceId || !targetId || sourceId === targetId) {
    showToast('Select two distinct muscle groups to merge');
    return;
  }
  const res = await apiFetch(`/api/admin/muscle-groups/${sourceId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
  });
  showToast(res.message || 'Muscle groups merged');
  await Promise.all([loadGroups(), loadExercises()]);
  updateKpiStats();
});

$('cfg-hero-bg').addEventListener('input', updatePreview);
$('cfg-banner').addEventListener('input', updatePreview);
$('cfg-note').addEventListener('input', updatePreview);

$('reset-bg-btn').addEventListener('click', () => {
  $('cfg-hero-bg').value = '';
  updatePreview();
});

$('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('cfg-status').textContent = 'SAVING...';
  await apiFetch('/api/admin/site-config', {
    method: 'PUT',
    body: JSON.stringify({
      heroBackgroundUrl: $('cfg-hero-bg').value,
      announcementBanner: $('cfg-banner').value,
      featuredNote: $('cfg-note').value,
    }),
  });
  $('cfg-status').textContent = 'PUBLISHED';
  showToast('Site configuration published');
  updatePreview();
});

const renderFeedbacks = () => {
  const tbody = $('feedbacks-tbody');
  if (!tbody) return;
  const statusFilter = $('feedback-status-filter')?.value || '';
  const sourceFilter = $('feedback-source-filter')?.value || '';
  const filtered = feedbacksCache.filter((item) => {
    if (statusFilter && item.status !== statusFilter) return false;
    if (sourceFilter && (item.source || 'web') !== sourceFilter) return false;
    return true;
  });

  tbody.innerHTML = '';
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted text-center" style="padding: 2rem;">No feedbacks found.</td></tr>';
    return;
  }

  const statusBadgeMap = {
    resolved: 'badge-lime',
    reviewed: 'badge-blue',
    pending: 'badge-orange',
  };

  filtered.forEach((item) => {
    const tr = document.createElement('tr');
    const createdDate = item.createdAt ? new Date(item.createdAt).toLocaleString() : 'N/A';
    const currentStatus = item.status || 'pending';
    const statusBadgeClass = statusBadgeMap[currentStatus] || 'badge-orange';
    const itemSource = (item.source || 'web').toLowerCase();

    tr.innerHTML = `
      <td class="mono-meta"></td>
      <td>
        <strong class="feedback-user-name"></strong>
        <span class="muted feedback-user-email"></span>
      </td>
      <td class="text-center">
        <span class="feedback-source-badge"></span>
      </td>
      <td class="text-center">
        <span class="badge-gray feedback-screen-badge"></span>
      </td>
      <td class="feedback-content"></td>
      <td class="text-center"><span class="feedback-status-badge"></span></td>
      <td>
        <div class="row-actions">
          <select class="ft-input feedback-status-sel">
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
          </select>
          <button type="button" class="ft-btn-ghost btn-sm delete-feedback-btn" aria-label="Delete feedback">✕</button>
        </div>
      </td>
    `;
    tr.children[0].textContent = createdDate;
    tr.querySelector('.feedback-user-name').textContent = item.userName || 'Anonymous';
    tr.querySelector('.feedback-user-email').textContent = item.userEmail || '';

    const sourceBadgeEl = tr.querySelector('.feedback-source-badge');
    sourceBadgeEl.className = `feedback-source-badge ${itemSource === 'mobile' ? 'badge-blue' : 'badge-gray'}`;
    sourceBadgeEl.textContent = itemSource.toUpperCase();

    tr.querySelector('.feedback-screen-badge').textContent = item.screen || 'General';
    tr.querySelector('.feedback-content').textContent = item.content || '';

    const badgeEl = tr.querySelector('.feedback-status-badge');
    badgeEl.className = `feedback-status-badge ${statusBadgeClass}`;
    badgeEl.textContent = currentStatus.toUpperCase();

    const selectEl = tr.querySelector('.feedback-status-sel');
    selectEl.value = currentStatus;
    selectEl.dataset.id = item.id;

    const deleteBtn = tr.querySelector('.delete-feedback-btn');
    deleteBtn.dataset.id = item.id;

    selectEl.addEventListener('change', async (e) => {
      const prevStatus = currentStatus;
      const newStatus = e.target.value;
      selectEl.disabled = true;
      try {
        await apiFetch(`/api/admin/feedbacks/${item.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus }),
        });
        showToast(`Feedback status updated to ${newStatus}`);
        await loadFeedbacks();
      } catch (err) {
        selectEl.value = prevStatus;
        showToast(err.message);
      } finally {
        if (selectEl.isConnected) selectEl.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete this feedback?')) return;
      try {
        await apiFetch(`/api/admin/feedbacks/${item.id}`, { method: 'DELETE' });
        showToast('Feedback deleted');
        await loadFeedbacks();
      } catch (err) {
        showToast(err.message);
      }
    });

    tbody.appendChild(tr);
  });
};

const loadFeedbacks = async () => {
  feedbacksCache = await apiFetch('/api/admin/feedbacks');
  renderFeedbacks();
  updateFeedbackStats();
};

const switchTab = (activeTabId, activePanelId) => {
  ['tab-exercises', 'tab-groups', 'tab-config', 'tab-feedbacks'].forEach((id) => $(id).classList.remove('active'));
  ['panel-exercises', 'panel-groups', 'panel-config', 'panel-feedbacks'].forEach((id) => $(id).classList.add('hidden'));
  $(activeTabId).classList.add('active');
  $(activePanelId).classList.remove('hidden');
  if (activeTabId === 'tab-feedbacks') {
    loadFeedbacks().catch((err) => showToast(err.message));
  }
};

$('tab-exercises').addEventListener('click', () => switchTab('tab-exercises', 'panel-exercises'));
$('tab-groups').addEventListener('click', () => switchTab('tab-groups', 'panel-groups'));
$('tab-config').addEventListener('click', () => switchTab('tab-config', 'panel-config'));
$('tab-feedbacks').addEventListener('click', () => switchTab('tab-feedbacks', 'panel-feedbacks'));
$('feedback-status-filter').addEventListener('change', renderFeedbacks);
$('feedback-source-filter').addEventListener('change', renderFeedbacks);
$('refresh-feedbacks-btn').addEventListener('click', async () => {
  try {
    await loadFeedbacks();
    showToast('Feedbacks refreshed');
  } catch (err) {
    showToast(err.message);
  }
});

const customSelectSyncers = [];

const syncAllCustomSelects = () => {
  customSelectSyncers.forEach((fn) => fn());
};

const closeAllSelectMenus = (exceptMenu = null) => {
  document.querySelectorAll('.ft-select-menu').forEach((menu) => {
    if (menu !== exceptMenu) menu.classList.add('hidden');
  });
};

const enhanceSelect = (selectEl) => {
  if (!selectEl || selectEl.dataset.enhanced === '1') return;
  selectEl.dataset.enhanced = '1';

  const wrap = document.createElement('div');
  wrap.className = 'ft-select-wrap';
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.classList.add('ft-native-select');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ft-input ft-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const labelSpan = document.createElement('span');
  const chevron = document.createElement('span');
  chevron.className = 'ft-select-chevron';
  chevron.textContent = '▾';
  trigger.appendChild(labelSpan);
  trigger.appendChild(chevron);

  const menu = document.createElement('div');
  menu.className = 'ft-select-menu hidden';
  menu.setAttribute('role', 'listbox');

  wrap.appendChild(trigger);
  wrap.appendChild(menu);

  const sync = () => {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    labelSpan.textContent = selectedOpt ? selectedOpt.textContent : '';
    menu.innerHTML = '';
    Array.from(selectEl.options).forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ft-select-option' + (opt.value === selectEl.value ? ' is-selected' : '');
      btn.textContent = opt.textContent;
      btn.addEventListener('click', () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
        menu.classList.add('hidden');
      });
      menu.appendChild(btn);
    });
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.contains('hidden');
    closeAllSelectMenus(menu);
    if (isHidden) {
      sync();
      menu.classList.remove('hidden');
    } else {
      menu.classList.add('hidden');
    }
  });

  selectEl.addEventListener('change', sync);
  customSelectSyncers.push(sync);
  sync();
};

document.addEventListener('click', () => closeAllSelectMenus());
['ex-category', 'ex-difficulty', 'exercise-category-filter', 'exercise-status-filter', 'merge-source', 'merge-target', 'feedback-status-filter', 'feedback-source-filter']
  .forEach((id) => enhanceSelect($(id)));

if (sessionStorage.getItem(TOKEN_KEY)) {
  showDashboard().catch(showLogin);
}
