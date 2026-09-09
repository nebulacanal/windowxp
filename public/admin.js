const wrap = document.getElementById('admin-wrap');

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 16);
}

async function loadAdminPage() {
  let me;
  try {
    const meRes = await fetch('/api/auth/me');
    if (!meRes.ok) throw new Error('not logged in');
    me = await meRes.json();
  } catch (err) {
    wrap.innerHTML = `
      <div class="denied">
        <p>로그인이 필요해요.</p>
        <a href="/">로그인하러 가기</a>
      </div>`;
    return;
  }

  if (!me.isAdmin) {
    wrap.innerHTML = `
      <div class="denied">
        <p>관리자만 볼 수 있는 페이지예요.</p>
        <a href="/">홈으로 돌아가기</a>
      </div>`;
    return;
  }

  render();
}

async function render() {
  wrap.innerHTML = `
    <div class="admin-header">
      <h1>가입 승인 관리</h1>
      <button class="btn-back" onclick="location.href='/'">← 나가기</button>
    </div>
    <div id="pending-list"><p>불러오는 중...</p></div>
    <div class="section-title">전체 사용자</div>
    <div id="user-list"><p>불러오는 중...</p></div>
    <div class="section-title">메뉴 노출 설정</div>
    <div id="menu-settings"><p>불러오는 중...</p></div>
  `;

  await Promise.all([renderPending(), renderAllUsers(), renderMenuSettings()]);
}

const MENU_LABELS = {
  memo: '📝 메모장',
  shop: '💿 알씨 (상점)',
  soribada: '🎵 소리바다',
  feed: '🌐 IE (피드)',
  msn: '💬 msn (블라인드)',
  taste: 'ℹ️ 취향표',
  diary: '💌 교환일기',
};

async function renderMenuSettings() {
  const target = document.getElementById('menu-settings');
  const res = await fetch('/api/admin/menus');
  if (!res.ok) {
    target.innerHTML = `<p class="empty-note">불러오지 못했어요.</p>`;
    return;
  }
  const { menus } = await res.json();

  target.innerHTML = Object.entries(menus)
    .map(
      ([key, enabled]) => `
      <div class="user-row">
        <div class="nickname">${MENU_LABELS[key] || key}</div>
        <label class="menu-toggle">
          <input type="checkbox" data-key="${key}" ${enabled ? 'checked' : ''} onchange="toggleMenu(this)">
          <span>${enabled ? '켜짐' : '꺼짐'}</span>
        </label>
      </div>`
    )
    .join('');
}

async function toggleMenu(el) {
  const key = el.dataset.key;
  await fetch(`/api/admin/menus/${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: el.checked }),
  });
  renderMenuSettings();
}

async function renderPending() {
  const target = document.getElementById('pending-list');
  const res = await fetch('/api/admin/pending');
  if (!res.ok) {
    target.innerHTML = `<p class="empty-note">목록을 불러오지 못했어요.</p>`;
    return;
  }
  const { pending } = await res.json();

  if (pending.length === 0) {
    target.innerHTML = `<p class="empty-note">대기 중인 가입 신청이 없어요.</p>`;
    return;
  }

  target.innerHTML = pending
    .map(
      (u) => `
      <div class="user-row" id="row-${u.id}">
        <div>
          <div class="nickname">${escapeHtml(u.nickname)} <span class="status-badge status-pending">${escapeHtml(u.badge)}</span></div>
          <div class="meta">신청일: ${formatDate(u.created_at)}</div>
        </div>
        <div class="btn-group">
          <button class="btn-approve" onclick="approveUser(${u.id})">승인</button>
          <button class="btn-reject" onclick="rejectUser(${u.id})">거절</button>
        </div>
      </div>`
    )
    .join('');
}

async function renderAllUsers() {
  const target = document.getElementById('user-list');
  const res = await fetch('/api/admin/users');
  if (!res.ok) {
    target.innerHTML = `<p class="empty-note">목록을 불러오지 못했어요.</p>`;
    return;
  }
  const { users } = await res.json();

  target.innerHTML = users
    .map((u) => {
      const badgeClass =
        u.status === 'approved' ? 'status-approved' : u.status === 'rejected' ? 'status-rejected' : 'status-pending';
      const badgeLabel = u.status === 'approved' ? '승인됨' : u.status === 'rejected' ? '거절됨' : '대기중';
      return `
      <div class="user-row">
        <div>
          <div class="nickname">${escapeHtml(u.nickname)} ${u.is_admin ? '👑' : ''} (${escapeHtml(u.badge)})
            <span class="status-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <div class="meta">가입: ${formatDate(u.created_at)} · 포인트: ${u.points}</div>
        </div>
      </div>`;
    })
    .join('');
}

async function approveUser(id) {
  await fetch(`/api/admin/approve/${id}`, { method: 'POST' });
  await render();
}

async function rejectUser(id) {
  if (!confirm('이 가입 신청을 거절할까요?')) return;
  await fetch(`/api/admin/reject/${id}`, { method: 'POST' });
  await render();
}

loadAdminPage();
