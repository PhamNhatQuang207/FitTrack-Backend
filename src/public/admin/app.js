const TOKEN_KEY = 'fittrack_admin_token';
let exercisesCache = [];
let groupsCache = [];

const $ = (id) => document.getElementById(id);

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

const showDashboard = async () => {
  $('login-view').classList.add('hidden');
  $('dashboard-view').classList.remove('hidden');
  await Promise.all([loadGroups(), loadExercises(), loadSiteConfig()]);
};

const showLogin = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  $('dashboard-view').classList.add('hidden');
  $('login-view').classList.remove('hidden');
};

const populateCategorySelect = () => {
  const select = $('ex-category');
  select.innerHTML = '';
  groupsCache
    .filter((g) => g.isActive !== false)
    .forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.name;
      opt.textContent = g.name;
      select.appendChild(opt);
    });
};

const renderGroups = () => {
  const tbody = $('groups-tbody');
  tbody.innerHTML = '';
  groupsCache.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td></td>
      <td></td>
      <td>${g.isActive ? 'Active' : 'Hidden'}</td>
      <td class="row-actions">
        <button type="button" class="btn-secondary edit-grp">Rename/Edit</button>
        <button type="button" class="btn-secondary toggle-grp">${g.isActive ? 'Hide' : 'Restore'}</button>
        <button type="button" class="btn-secondary merge-grp">Merge Into...</button>
      </td>
    `;
    tr.children[0].textContent = g.name;
    tr.children[1].textContent = g.slug;
    tr.querySelector('.edit-grp').addEventListener('click', () => {
      $('grp-id').value = g.id;
      $('grp-name').value = g.name;
      $('grp-icon').value = g.iconUrl || '';
    });
    tr.querySelector('.toggle-grp').addEventListener('click', async () => {
      await apiFetch(`/api/admin/muscle-groups/${g.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !g.isActive }),
      });
      await loadGroups();
    });
    tr.querySelector('.merge-grp').addEventListener('click', async () => {
      const targetName = window.prompt(`Merge "${g.name}" into which existing Muscle Group name?`);
      if (!targetName) return;
      const target = groupsCache.find((x) => x.name.toLowerCase() === targetName.trim().toLowerCase());
      if (!target || target.id === g.id) {
        window.alert('Target muscle group not found.');
        return;
      }
      await apiFetch(`/api/admin/muscle-groups/${g.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ targetId: target.id }),
      });
      await Promise.all([loadGroups(), loadExercises()]);
    });
    tbody.appendChild(tr);
  });
};

const loadGroups = async () => {
  groupsCache = await apiFetch('/api/admin/muscle-groups');
  populateCategorySelect();
  renderGroups();
};

const renderExercises = () => {
  const q = $('exercise-search').value.trim().toLowerCase();
  const tbody = $('exercises-tbody');
  tbody.innerHTML = '';

  exercisesCache
    .filter((ex) => !q || ex.name.toLowerCase().includes(q) || ex.category.toLowerCase().includes(q))
    .forEach((ex) => {
      const tr = document.createElement('tr');
      const active = ex.isActive !== false;
      tr.innerHTML = `
        <td></td>
        <td></td>
        <td></td>
        <td>${active ? 'Active' : 'Hidden'}</td>
        <td class="row-actions">
          <button type="button" class="btn-secondary edit-btn">Edit</button>
          <button type="button" class="btn-secondary toggle-btn">${active ? 'Hide' : 'Restore'}</button>
        </td>
      `;
      tr.children[0].textContent = ex.name;
      tr.children[1].textContent = ex.category;
      tr.children[2].textContent = ex.equipment || '-';
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditForm(ex));
      tr.querySelector('.toggle-btn').addEventListener('click', () => toggleStatus(ex.id, !active));
      tbody.appendChild(tr);
    });
};

const loadExercises = async () => {
  exercisesCache = await apiFetch('/api/admin/exercises');
  renderExercises();
};

const openEditForm = (ex = null) => {
  $('exercise-form').classList.remove('hidden');
  $('exercise-form-title').textContent = ex ? 'Edit Exercise' : 'New Exercise';
  $('ex-id').value = ex ? ex.id : '';
  $('ex-name').value = ex ? ex.name : '';
  if (ex && ex.category) $('ex-category').value = ex.category;
  $('ex-muscle').value = ex ? (ex.muscleGroup || '') : '';
  $('ex-equipment').value = ex ? (ex.equipment || '') : '';
  $('ex-difficulty').value = ex ? (ex.difficulty || 'Beginner') : 'Beginner';
  $('ex-image').value = ex ? (ex.imageUrl || '') : '';
  $('ex-instructions').value = ex && Array.isArray(ex.instructions) ? ex.instructions.join('\n') : '';
};

const toggleStatus = async (id, isActive) => {
  await apiFetch(`/api/admin/exercises/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive }),
  });
  await loadExercises();
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
  const img = $('cfg-hero-preview');
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
  } else {
    img.classList.add('hidden');
  }
};

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const data = await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('login-username').value,
        password: $('login-password').value,
      }),
    });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    await showDashboard();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout-btn').addEventListener('click', showLogin);
$('exercise-search').addEventListener('input', renderExercises);
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
  };

  if (id) {
    await apiFetch(`/api/admin/exercises/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await apiFetch('/api/admin/exercises', { method: 'POST', body: JSON.stringify(payload) });
  }
  $('exercise-form').classList.add('hidden');
  await loadExercises();
});

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('grp-id').value;
  const payload = {
    name: $('grp-name').value,
    iconUrl: $('grp-icon').value,
  };
  if (id) {
    await apiFetch(`/api/admin/muscle-groups/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  } else {
    await apiFetch('/api/admin/muscle-groups', { method: 'POST', body: JSON.stringify(payload) });
  }
  $('grp-id').value = '';
  $('grp-name').value = '';
  $('grp-icon').value = '';
  await Promise.all([loadGroups(), loadExercises()]);
});

$('cancel-group-btn').addEventListener('click', () => {
  $('grp-id').value = '';
  $('grp-name').value = '';
  $('grp-icon').value = '';
});

$('cfg-hero-bg').addEventListener('input', updatePreview);
$('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('cfg-status').textContent = 'Saving...';
  await apiFetch('/api/admin/site-config', {
    method: 'PUT',
    body: JSON.stringify({
      heroBackgroundUrl: $('cfg-hero-bg').value,
      announcementBanner: $('cfg-banner').value,
      featuredNote: $('cfg-note').value,
    }),
  });
  $('cfg-status').textContent = 'Saved!';
});

const switchTab = (activeTabId, activePanelId) => {
  ['tab-exercises', 'tab-groups', 'tab-config'].forEach((id) => $(id).classList.remove('active'));
  ['panel-exercises', 'panel-groups', 'panel-config'].forEach((id) => $(id).classList.add('hidden'));
  $(activeTabId).classList.add('active');
  $(activePanelId).classList.remove('hidden');
};

$('tab-exercises').addEventListener('click', () => switchTab('tab-exercises', 'panel-exercises'));
$('tab-groups').addEventListener('click', () => switchTab('tab-groups', 'panel-groups'));
$('tab-config').addEventListener('click', () => switchTab('tab-config', 'panel-config'));

if (sessionStorage.getItem(TOKEN_KEY)) {
  showDashboard().catch(showLogin);
}
