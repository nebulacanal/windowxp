const xpScreen = document.getElementById('xp-screen');
const appScreen = document.getElementById('app-screen');

const tileLogin = document.getElementById('tile-login');
const tileSignup = document.getElementById('tile-signup');
const loginPanel = document.getElementById('login-panel');
const signupPanel = document.getElementById('signup-panel');
const signupSub = document.getElementById('signup-sub');
const loginHighlight = document.getElementById('login-highlight');
const signupHighlight = document.getElementById('signup-highlight');

const loginError = document.getElementById('login-error');
const signupError = document.getElementById('signup-error');
const signupNotice = document.getElementById('signup-notice');

const welcomeNickname = document.getElementById('welcome-nickname');
const welcomePoints = document.getElementById('welcome-points');
const logoutBtn = document.getElementById('logout-btn');
const adminLink = document.getElementById('admin-link');
const winBody = document.getElementById('win-body');
const winTitleText = document.getElementById('win-title-text');

let currentUser = { nickname: '', isAdmin: false, points: 0 };
const HOME_VIEW_HTML = winBody.innerHTML; // 페이지 로드 시점의 기본(홈) 화면을 기억해둠

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const TILE_HEIGHT_COLLAPSED = 64;
const TILE_HEIGHT_LOGIN_EXPANDED = 112;

function expandTile(which) {
  if (which === 'signup') {
    signupPanel.classList.add('panel-open');
    signupSub.textContent = '아래 정보를 입력하세요';
    tileSignup.classList.add('active');
    loginPanel.classList.remove('panel-open');
    tileLogin.classList.remove('active');

    loginHighlight.style.height = TILE_HEIGHT_COLLAPSED + 'px';
    signupHighlight.style.top = '0';
    signupHighlight.style.bottom = '0';
    signupHighlight.style.height = 'auto';
  } else {
    loginPanel.classList.add('panel-open');
    tileLogin.classList.add('active');
    signupPanel.classList.remove('panel-open');
    signupSub.textContent = '클릭해서 가입 신청하기';
    tileSignup.classList.remove('active');

    loginHighlight.style.height = TILE_HEIGHT_LOGIN_EXPANDED + 'px';
    signupHighlight.style.bottom = 'auto';
    signupHighlight.style.height = TILE_HEIGHT_COLLAPSED + 'px';
  }
}

tileLogin.addEventListener('click', (e) => {
  // 입력 요소를 직접 클릭했을 때는 무시 (버블링으로 인한 중복 트리거 방지)
  if (!tileLogin.classList.contains('active')) expandTile('login');
});
tileSignup.addEventListener('click', () => {
  if (!tileSignup.classList.contains('active')) expandTile('signup');
});

loginHighlight.style.height = TILE_HEIGHT_LOGIN_EXPANDED + 'px';

function showApp(nickname, isAdmin, pointsBalance) {
  currentUser = { nickname, isAdmin: !!isAdmin, points: typeof pointsBalance === 'number' ? pointsBalance : 0 };
  xpScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  document.getElementById('admin-icon').classList.toggle('hidden', !currentUser.isAdmin);
  document.querySelectorAll('.window-side-menu .desktop-icon').forEach((i) => i.classList.remove('active'));
  const myComputerIcon = document.querySelector('.window-side-menu .desktop-icon[data-view="my-computer"]');
  if (myComputerIcon) myComputerIcon.classList.add('active');
  renderMyComputerView();
  updateClock();
  refreshNotifBadge();
  applyMenuVisibility();
}

async function applyMenuVisibility() {
  if (currentUser.isAdmin) return; // 관리자는 항상 전부 보임 (관리/테스트 목적)
  try {
    const res = await fetch('/api/settings/menus');
    if (!res.ok) return;
    const { menus } = await res.json();
    document.querySelectorAll('.window-side-menu .desktop-icon[data-view]').forEach((icon) => {
      const key = icon.dataset.view;
      if (Object.prototype.hasOwnProperty.call(menus, key) && !menus[key]) {
        icon.classList.add('hidden');
      }
    });
  } catch (err) {
    // 조용히 무시
  }
}

function showXp() {
  xpScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

function pad(n) {
  return n.toString().padStart(2, '0');
}
function updateClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;
  const d = new Date();
  clockEl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
}
setInterval(updateClock, 1000 * 30);

/* ===== 알림 벨 ===== */

function formatNotifTime(iso) {
  if (!iso) return '';
  return iso.slice(5, 16);
}

function formatNotificationText(n) {
  let payload = {};
  try { payload = JSON.parse(n.payload || '{}'); } catch (err) { /* noop */ }

  switch (n.type) {
    case 'points': {
      const amt = payload.amount || 0;
      const verb = amt > 0 ? '적립' : '차감';
      return `💰 포인트 ${Math.abs(amt)}P ${verb} (${escapeHtml(payload.reason || '')})`;
    }
    case 'poke':
      return '👉 누군가 나를 찔렀어요!';
    case 'item_received':
      return `🎁 아이템을 받았어요: ${escapeHtml(payload.itemName || '')}`;
    case 'soribada':
      return `🎵 누군가 나에게 자장가(mp3)를 보냈어요${payload.itemName ? ': ' + escapeHtml(payload.itemName) : ''}`;
    case 'msn_topic':
      return `📌 msn에 새 주제가 등록됐어요${payload.preview ? ': ' + escapeHtml(payload.preview) : ''}`;
    case 'msn_reply':
      return '💬 msn 대화에 새 메시지가 도착했어요';
    case 'feed_comment_unlocked':
      return '🔓 누군가 내 비밀 댓글을 열람했어요';
    case 'taste_viewed':
      return '👀 누군가 내 취향표를 열람했어요';
    default:
      return '새 알림이 있어요.';
  }
}

let notifPanelOpen = false;

async function refreshNotifBadge() {
  if (appScreen.classList.contains('hidden')) return; // 로그인 전에는 조회 안 함
  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const { unreadCount } = await res.json();
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    if (unreadCount > 0) {
      badge.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) {
    // 조용히 무시 (뱃지 갱신 실패는 크게 중요하지 않음)
  }
}
setInterval(refreshNotifBadge, 1000 * 20);

function renderNotifList(notifications) {
  const listEl = document.getElementById('notif-panel-list');
  listEl.innerHTML = notifications.length
    ? notifications
        .map(
          (n) => `
          <div class="notif-item ${n.is_read ? 'read' : 'unread'}" data-id="${n.id}">
            <div class="notif-item-body" data-id="${n.id}">
              ${formatNotificationText(n)}
              <span class="notif-item-time">${formatNotifTime(n.created_at)}</span>
            </div>
            <span class="notif-item-close" data-id="${n.id}">✕</span>
          </div>`
        )
        .join('')
    : '<p class="notif-empty">새 알림이 없어요.</p>';

  listEl.querySelectorAll('.notif-item-body').forEach((el) => {
    el.addEventListener('click', async () => {
      const row = el.closest('.notif-item');
      if (row.classList.contains('unread')) {
        row.classList.remove('unread');
        row.classList.add('read');
        try {
          await fetch('/api/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [Number(el.dataset.id)] }),
          });
          refreshNotifBadge();
        } catch (err) {
          // 무시
        }
      }
    });
  });

  listEl.querySelectorAll('.notif-item-close').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = el.closest('.notif-item');
      row.remove();
      try {
        await fetch(`/api/notifications/${el.dataset.id}`, { method: 'DELETE' });
        refreshNotifBadge();
        if (!listEl.querySelector('.notif-item')) {
          listEl.innerHTML = '<p class="notif-empty">새 알림이 없어요.</p>';
        }
      } catch (err) {
        // 무시
      }
    });
  });
}

async function loadNotifPanel() {
  const listEl = document.getElementById('notif-panel-list');
  listEl.innerHTML = '<p class="notif-empty">불러오는 중...</p>';
  try {
    const res = await fetch('/api/notifications');
    const { notifications } = await res.json();
    renderNotifList(notifications);
  } catch (err) {
    listEl.innerHTML = '<p class="notif-empty">불러오지 못했어요.</p>';
  }
}

async function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;

  if (notifPanelOpen) {
    panel.classList.add('hidden');
    notifPanelOpen = false;
    return;
  }

  notifPanelOpen = true;
  panel.classList.remove('hidden');
  loadNotifPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  const bellWrap = document.getElementById('notif-bell-wrap');
  if (!bellWrap) return;
  bellWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleNotifPanel();
  });
  document.addEventListener('click', (e) => {
    if (notifPanelOpen && !e.target.closest('#notif-bell-wrap')) {
      document.getElementById('notif-panel').classList.add('hidden');
      notifPanelOpen = false;
    }
  });

  const markAllBtn = document.getElementById('notif-mark-all');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      loadNotifPanel();
      refreshNotifBadge();
    });
  }

  const deleteAllBtn = document.getElementById('notif-delete-all');
  if (deleteAllBtn) {
    deleteAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('모든 알림을 삭제할까요?')) return;
      await fetch('/api/notifications', { method: 'DELETE' });
      loadNotifPanel();
      refreshNotifBadge();
    });
  }
});

/* ===== 메인 창 안 화면 전환 ===== */

function renderHomeView() {
  winTitleText.textContent = '7979 - 메인 메뉴';
  winBody.innerHTML = HOME_VIEW_HTML;
  document.getElementById('welcome-nickname').textContent = currentUser.nickname;
  document.getElementById('welcome-points').textContent = currentUser.points;
  document.getElementById('admin-link').classList.toggle('hidden', !currentUser.isAdmin);
}

function pencilIconSvg() {
  return `<svg viewBox="0 0 16 16" fill="none" width="13" height="13">
    <path d="M11.4 1.4a1.4 1.4 0 0 1 2 0l1.2 1.2a1.4 1.4 0 0 1 0 2L5.4 13.8l-3.8 1 1-3.8L11.4 1.4Z" fill="#fff" stroke="#4C5F91" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M10 3.2l2.8 2.8" stroke="#4C5F91" stroke-width="1.1"/>
  </svg>`;
}

function driveIconSvg(color) {
  return `<svg viewBox="0 0 32 22" width="26" height="18">
    <rect x="1.5" y="5" width="21" height="12" rx="2.2" fill="#EDF1FA" stroke="#8A97B8" stroke-width="1.3"/>
    <rect x="21" y="8" width="9" height="6" rx="1.3" fill="#D3DAE8" stroke="#8A97B8" stroke-width="1.1"/>
    <circle cx="7" cy="11" r="2.1" fill="${color}"/>
  </svg>`;
}

async function renderMyComputerView() {
  winTitleText.textContent = '내 컴퓨터 - 내 정보';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const [profileRes, invRes, adsRes] = await Promise.all([
      fetch('/api/profile/me'),
      fetch('/api/shop/inventory'),
      fetch('/api/ads'),
    ]);
    if (!profileRes.ok) throw new Error('load-failed');
    const { profile } = await profileRes.json();
    const inv = invRes.ok ? await invRes.json() : { received: [], purchased: [], used: [], magnifierCount: 0 };
    const { banners } = adsRes.ok ? await adsRes.json() : { banners: {} };

    // ── 광고 배너 ─────────────────────────────────────────
    const largeBannerHtml = banners.large && banners.large.imageUrl
      ? `<a href="${escapeHtml(banners.large.linkUrl || '#')}" target="${banners.large.linkUrl ? '_blank' : '_self'}" class="ad-banner-large"><img src="${escapeHtml(banners.large.imageUrl)}" alt="광고" /></a>`
      : '';
    const smallBannerHtml = (slot) =>
      banners[slot] && banners[slot].imageUrl
        ? `<a href="${escapeHtml(banners[slot].linkUrl || '#')}" target="${banners[slot].linkUrl ? '_blank' : '_self'}" class="ad-banner-small"><img src="${escapeHtml(banners[slot].imageUrl)}" alt="광고" /></a>`
        : '';
    const small1Html = smallBannerHtml('small1');
    const small2Html = smallBannerHtml('small2');
    const smallRowHtml = small1Html || small2Html ? `<div class="ad-banner-row">${small1Html}${small2Html}</div>` : '';
    const adSectionHtml =
      largeBannerHtml || smallRowHtml ? `<div class="ad-banner-wrap">${largeBannerHtml}${smallRowHtml}</div>` : '';

    // ── 아이템 3종 목록 ─────────────────────────────────────────
    const purchasedRowsHtml = inv.purchased.length
      ? inv.purchased
          .map(
            (p) => `
            <div class="drive-item-row">
              <span class="drive-item-type">${SHOP_TYPE_LABEL[p.type] || p.type}</span>
              <span class="drive-item-name">${escapeHtml(p.itemName)}${p.recipientNickname ? ` → ${escapeHtml(p.recipientNickname)}` : ''}</span>
              <span class="feed-card-time">${formatFeedTime(p.createdAt)}</span>
            </div>`
          )
          .join('')
      : '<p class="view-muted">아직 구매한 아이템이 없어요.</p>';

    const receivedRowsHtml = inv.received.length
      ? inv.received
          .map((r) => {
            const senderLabel = r.revealed
              ? escapeHtml(r.senderNickname)
              : inv.magnifierCount > 0
              ? `<button type="button" class="feed-unlock-btn mycomp-reveal-btn" data-target-id="${r.id}">🔍 공개</button>`
              : '??? (돋보기 필요)';
            const extra = r.type === 'anon_note' && r.message ? ` "${escapeHtml(r.message)}"` : '';
            return `
              <div class="drive-item-row">
                <span class="drive-item-type">${SHOP_TYPE_LABEL[r.type] || r.type}</span>
                <span class="drive-item-name">${escapeHtml(r.itemName)}${extra} · from ${senderLabel}</span>
                <span class="feed-card-time">${formatFeedTime(r.createdAt)}</span>
              </div>`;
          })
          .join('')
      : '<p class="view-muted">아직 받은 아이템이 없어요.</p>';

    const usedRowsHtml = inv.used.length
      ? inv.used
          .map(
            (u) => `
            <div class="drive-item-row">
              <span class="drive-item-type">${SHOP_TYPE_LABEL[u.type] || u.type}</span>
              <span class="drive-item-name">${escapeHtml(u.itemName)}</span>
              <span class="feed-card-time">${formatFeedTime(u.createdAt)}</span>
            </div>`
          )
          .join('')
      : '<p class="view-muted">아직 사용한 아이템이 없어요.</p>';

    const photoStyle = profile.profileImageUrl
      ? `background-image:url('${escapeHtml(profile.profileImageUrl)}'); background-size:cover; background-position:center;`
      : '';

    winBody.innerHTML = `
      ${adSectionHtml}

      <div class="profile-card">
        <div class="profile-photo-wrap">
          <div class="profile-photo-box" style="${photoStyle}"></div>
          <div class="profile-photo-edit-btn" id="profile-photo-edit-btn">${pencilIconSvg()}</div>
        </div>
        <div class="profile-card-info">
          <div class="profile-card-nick">${escapeHtml(profile.nickname)}</div>
          <div class="profile-card-intro-row">
            <span class="profile-card-intro" id="profile-intro-display">${escapeHtml(profile.profile_note) || '<span class="view-muted">소개를 작성해보세요</span>'}</span>
            <span class="profile-intro-edit-btn" id="profile-intro-edit-btn">${pencilIconSvg()}</span>
          </div>
          <div class="profile-card-bottom-row">
            <span class="profile-card-points">💰 ${profile.points}P</span>
            <span class="pref-badge pref-top">${escapeHtml(profile.badge)}</span>
          </div>
        </div>
      </div>

      <div class="drive-section">
        <div class="drive-section-title">${driveIconSvg('#3B82ED')} 구매한 아이템 (I:)</div>
        <div class="drive-item-list">${purchasedRowsHtml}</div>
      </div>
      <div class="drive-section">
        <div class="drive-section-title">${driveIconSvg('#3ED67A')} 받은 아이템 (L:)</div>
        <div class="drive-item-list">${receivedRowsHtml}</div>
      </div>
      <div class="drive-section">
        <div class="drive-section-title">${driveIconSvg('#F4A93C')} 사용 내역 (H:)</div>
        <div class="drive-item-list">${usedRowsHtml}</div>
      </div>
    `;

    // 프로필 사진 수정
    document.getElementById('profile-photo-edit-btn').addEventListener('click', async () => {
      const url = prompt('프로필 사진 이미지 주소(URL)를 입력해 주세요:', profile.profileImageUrl || '');
      if (url === null) return;
      try {
        const r = await fetch('/api/profile/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileImageUrl: url.trim() }),
        });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '저장에 실패했어요.');
        renderMyComputerView();
      } catch (err) {
        alert('서버에 연결할 수 없어요.');
      }
    });

    // 자기소개 수정 (연필 누르면 편집 모드로 전환)
    document.getElementById('profile-intro-edit-btn').addEventListener('click', () => {
      const row = document.querySelector('.profile-card-intro-row');
      row.innerHTML = `
        <textarea id="profile-note-input" class="memo-input" maxlength="500" style="flex:1; min-height:50px;">${escapeHtml(profile.profile_note)}</textarea>
        <button type="button" id="profile-note-save" class="view-btn" style="margin-left:6px;">저장</button>
      `;
      document.getElementById('profile-note-save').addEventListener('click', async () => {
        const textarea = document.getElementById('profile-note-input');
        try {
          const r = await fetch('/api/profile/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileNote: textarea.value }),
          });
          const d = await r.json();
          if (!r.ok) return alert(d.error || '저장에 실패했어요.');
          renderMyComputerView();
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
        }
      });
    });

    document.querySelectorAll('.mycomp-reveal-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await fetch('/api/shop/reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPurchaseId: Number(btn.dataset.targetId) }),
          });
          const d = await r.json();
          if (!r.ok) {
            alert(d.error || '공개에 실패했어요.');
            btn.disabled = false;
            return;
          }
          renderMyComputerView();
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">정보를 불러오지 못했어요.</p>';
  }
}

async function renderMyDocumentsView() {
  winTitleText.textContent = '내 문서 - 회원 목록';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const [membersRes, statusRes] = await Promise.all([
      fetch('/api/members'),
      fetch('/api/members/pokes/status'),
    ]);
    if (!membersRes.ok || !statusRes.ok) throw new Error('load-failed');
    const { members } = await membersRes.json();
    const status = await statusRes.json();

    const rowsHtml = members
      .map((m) => {
        const isSelf = m.nickname === currentUser.nickname;
        return `
          <div class="member-row">
            <div class="member-info">
              <span class="member-nick">${escapeHtml(m.nickname)}</span>
              <span class="pref-badge pref-${m.preference}">${escapeHtml(m.badge)}</span>
            </div>
            <div class="member-note">${escapeHtml(m.profileNote || '(자기소개 없음)')}</div>
            <button type="button" class="poke-btn" data-id="${m.id}" ${isSelf ? 'disabled' : ''}>
              ${isSelf ? '나' : '찌르기'}
            </button>
          </div>
        `;
      })
      .join('');

    winBody.innerHTML = `
      <div class="poke-status">오늘 남은 찌르기: <strong id="poke-remaining">${status.remaining}</strong> / ${status.limit}</div>
      <div class="member-list">${rowsHtml}</div>
    `;

    document.querySelectorAll('.poke-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        btn.disabled = true;
        try {
          const res = await fetch(`/api/members/${id}/poke`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || '찌르기에 실패했어요.');
            btn.disabled = false;
            return;
          }
          document.getElementById('poke-remaining').textContent = data.remaining;
          btn.textContent = '찔렀어요!';
          if (data.remaining <= 0) {
            document.querySelectorAll('.poke-btn').forEach((b) => (b.disabled = true));
          } else {
            setTimeout(() => {
              btn.textContent = '찌르기';
              btn.disabled = false;
            }, 1200);
          }
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">회원 목록을 불러오지 못했어요.</p>';
  }
}

function renderPlaceholderView(label) {
  winTitleText.textContent = `${label} - 준비 중`;
  winBody.innerHTML = `<p class="view-muted view-placeholder">"${escapeHtml(label)}" 기능은 곧 만들어질 예정이에요.</p>`;
}

function formatMemoTime(iso) {
  if (!iso) return '';
  // "YYYY-MM-DD HH:MM:SS" -> "MM-DD HH:MM"
  return iso.slice(5, 16);
}

async function renderMemoView() {
  winTitleText.textContent = '메모장 - 익명 한마디';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch('/api/memo');
    if (!res.ok) throw new Error('load-failed');
    const { notes } = await res.json();

    const notesHtml = notes.length
      ? notes
          .map(
            (n) => `
            <div class="memo-note">
              <div class="memo-note-head">
                <span class="memo-note-author">${escapeHtml(n.anonName)}</span>
                <span class="memo-note-time">${formatMemoTime(n.createdAt)}</span>
              </div>
              <div class="memo-note-content">${escapeHtml(n.content)}</div>
            </div>`
          )
          .join('')
      : '<p class="view-muted view-placeholder">아직 아무도 한마디를 남기지 않았어요.</p>';

    winBody.innerHTML = `
      <div class="memo-compose">
        <input type="text" id="memo-input" class="memo-input" maxlength="200" placeholder="익명으로 한마디 남기기..." />
        <button type="button" id="memo-submit-btn" class="view-btn">등록</button>
      </div>
      <p id="memo-error" class="xp-error hidden" style="margin: 0 0 10px;"></p>
      <div class="memo-list" id="memo-list">${notesHtml}</div>
    `;

    const input = document.getElementById('memo-input');
    const errorEl = document.getElementById('memo-error');
    const submit = async () => {
      const content = input.value.trim();
      errorEl.classList.add('hidden');
      if (!content) return;
      try {
        const postRes = await fetch('/api/memo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const data = await postRes.json();
        if (!postRes.ok) {
          errorEl.textContent = data.error || '등록에 실패했어요.';
          errorEl.classList.remove('hidden');
          return;
        }
        input.value = '';
        renderMemoView();
      } catch (err) {
        errorEl.textContent = '서버에 연결할 수 없어요.';
        errorEl.classList.remove('hidden');
      }
    };
    document.getElementById('memo-submit-btn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">메모장을 불러오지 못했어요.</p>';
  }
}

async function renderSoribadaView() {
  winTitleText.textContent = '소리바다 - 자장가';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const [membersRes, tracksRes] = await Promise.all([
      fetch('/api/members'),
      fetch('/api/soribada'),
    ]);
    if (!membersRes.ok || !tracksRes.ok) throw new Error('load-failed');
    const { members } = await membersRes.json();
    const { tracks } = await tracksRes.json();

    const optionsHtml = members
      .map((m) => `<option value="${escapeHtml(m.nickname)}">${escapeHtml(m.nickname)}</option>`)
      .join('');

    const tracksHtml = tracks.length
      ? tracks
          .map(
            (t) => `
            <div class="soribada-track" data-video-id="${escapeHtml(t.videoId || '')}">
              <div class="soribada-track-info">
                <span class="soribada-file-icon">🎵</span>
                <span class="soribada-file-name">${escapeHtml(t.fileName)}</span>
              </div>
              <button type="button" class="soribada-play-btn">▶ 재생</button>
            </div>`
          )
          .join('')
      : '<p class="view-muted view-placeholder">아직 받은 자장가가 없어요.</p>';

    winBody.innerHTML = `
      <div class="soribada-compose">
        <div class="soribada-compose-title">mp3 보내기 (익명)</div>
        <div class="soribada-compose-row">
          <select id="soribada-to" class="soribada-select">
            <option value="">받는 사람 선택</option>
            ${optionsHtml}
          </select>
        </div>
        <div class="soribada-compose-row">
          <input type="text" id="soribada-title" class="xp-input" placeholder="제목 (띄어쓰기 없이 8글자)" maxlength="8" />
        </div>
        <div class="soribada-compose-row">
          <input type="text" id="soribada-url" class="xp-input" placeholder="유튜브 링크" />
        </div>
        <p id="soribada-error" class="xp-error hidden"></p>
        <button type="button" id="soribada-send-btn" class="view-btn">등록</button>
      </div>
      <div class="soribada-section-title">내 자장가</div>
      <div class="soribada-list" id="soribada-list">${tracksHtml}</div>
      <div id="soribada-player-wrap"></div>
    `;

    document.getElementById('soribada-send-btn').addEventListener('click', async () => {
      const errorEl = document.getElementById('soribada-error');
      errorEl.classList.add('hidden');
      const toNickname = document.getElementById('soribada-to').value;
      const title = document.getElementById('soribada-title').value.trim();
      const youtubeUrl = document.getElementById('soribada-url').value.trim();

      if (!toNickname || !title || !youtubeUrl) {
        errorEl.textContent = '모든 항목을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }

      try {
        const res = await fetch('/api/soribada', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toNickname, title, youtubeUrl }),
        });
        const data = await res.json();
        if (!res.ok) {
          errorEl.textContent = data.error || '등록에 실패했어요.';
          errorEl.classList.remove('hidden');
          return;
        }
        renderSoribadaView();
      } catch (err) {
        errorEl.textContent = '서버에 연결할 수 없어요.';
        errorEl.classList.remove('hidden');
      }
    });

    const playerWrap = document.getElementById('soribada-player-wrap');
    document.querySelectorAll('.soribada-track').forEach((row) => {
      const btn = row.querySelector('.soribada-play-btn');
      btn.addEventListener('click', () => {
        const isPlaying = row.classList.contains('playing');
        document.querySelectorAll('.soribada-track').forEach((r) => {
          r.classList.remove('playing');
          r.querySelector('.soribada-play-btn').textContent = '▶ 재생';
        });
        if (isPlaying) {
          playerWrap.innerHTML = '';
          return;
        }
        const videoId = row.dataset.videoId;
        if (!videoId) {
          playerWrap.innerHTML = '<p class="view-msg">이 트랙은 재생할 수 없어요.</p>';
          return;
        }
        row.classList.add('playing');
        btn.textContent = '⏸ 정지';
        playerWrap.innerHTML = `
          <iframe width="100%" height="70" src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1"
            frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
        `;
      });
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">소리바다를 불러오지 못했어요.</p>';
  }
}

const FEED_TYPE_LABEL = { normal: '일반', participatory: '참여형', secret: '비밀' };
const FEED_TYPE_CLASS = { normal: 'feed-type-normal', participatory: 'feed-type-participatory', secret: 'feed-type-secret' };

function formatFeedTime(iso) {
  if (!iso) return '';
  return iso.slice(5, 16);
}

function generateBlurFiller(length) {
  const pool = '가나다라마바사아자차카타파하김민수영지은서준하윤재현동민준호빈아름다운밤하늘별빛';
  const target = Math.max(6, Math.min(length || 12, 60));
  let result = '';
  while (result.length < target) result += pool;
  return result.slice(0, target);
}

function renderCommentHtml(comment) {
  if (comment.locked && comment.lockReason === 'need_comment') {
    return `
      <div class="feed-comment locked">
        <div class="feed-comment-head"><span class="feed-comment-nick">${escapeHtml(comment.nickname)}</span></div>
        <div class="feed-comment-content feed-comment-blurred">${escapeHtml(generateBlurFiller(comment.contentLength))}</div>
      </div>`;
  }
  if (comment.locked && comment.lockReason === 'need_unlock') {
    return `
      <div class="feed-comment locked">
        <div class="feed-comment-head"><span class="feed-comment-nick">${escapeHtml(comment.nickname)}</span></div>
        <div class="feed-comment-content feed-comment-blurred">${escapeHtml(generateBlurFiller(comment.contentLength))}</div>
        <button type="button" class="feed-unlock-btn" data-comment-id="${comment.id}">💰 ${comment.unlockPrice}P로 열람</button>
      </div>`;
  }
  return `
    <div class="feed-comment">
      <div class="feed-comment-head">
        <span class="feed-comment-nick">${escapeHtml(comment.nickname)}</span>
        <span class="feed-comment-time">${formatFeedTime(comment.createdAt)}</span>
        ${comment.isOwn ? `<span class="feed-comment-delete" data-comment-id="${comment.id}">삭제</span>` : ''}
      </div>
      <div class="feed-comment-content">${escapeHtml(comment.content)}</div>
    </div>`;
}

function bindCommentActions(container, feedId) {
  container.querySelectorAll('.feed-unlock-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const res = await fetch(`/api/feeds/comments/${btn.dataset.commentId}/unlock`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || '열람에 실패했어요.');
          btn.disabled = false;
          return;
        }
        renderFeedView();
      } catch (err) {
        alert('서버에 연결할 수 없어요.');
        btn.disabled = false;
      }
    });
  });
  container.querySelectorAll('.feed-comment-delete').forEach((el) => {
    el.addEventListener('click', async () => {
      if (!confirm('댓글을 삭제할까요?')) return;
      try {
        const res = await fetch(`/api/feeds/comments/${el.dataset.commentId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || '삭제에 실패했어요.');
          return;
        }
        renderFeedView();
      } catch (err) {
        alert('서버에 연결할 수 없어요.');
      }
    });
  });
}

async function toggleFeedComments(feedId, feed) {
  const card = document.querySelector(`.feed-card[data-feed-id="${feedId}"]`);
  if (!card) return;
  const wrap = card.querySelector('.feed-comments');
  const expanded = card.dataset.expanded === 'true';

  if (expanded) {
    // 다시 접기: 미리 갖고 있던 미리보기(최근 2개)로 되돌림
    card.dataset.expanded = 'false';
    wrap.innerHTML = feed.previewComments.map(renderCommentHtml).join('') || '<p class="view-muted">아직 댓글이 없어요.</p>';
    bindCommentActions(wrap, feedId);
    return;
  }

  if (feed.commentCount <= feed.previewComments.length) return; // 더 볼 댓글이 없으면 아무 것도 안 함

  wrap.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch(`/api/feeds/${feedId}/comments`);
    const data = await res.json();
    wrap.innerHTML = data.comments.map(renderCommentHtml).join('') || '<p class="view-muted">아직 댓글이 없어요.</p>';
    bindCommentActions(wrap, feedId);
    card.dataset.expanded = 'true';
  } catch (err) {
    wrap.innerHTML = '<p class="view-msg">댓글을 불러오지 못했어요.</p>';
  }
}

async function renderFeedView() {
  winTitleText.textContent = 'IE - 피드';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch('/api/feeds');
    if (!res.ok) throw new Error('load-failed');
    const { feeds } = await res.json();
    const feedsById = {};
    feeds.forEach((f) => { feedsById[f.id] = f; });

    const feedsHtml = feeds.length
      ? feeds
          .map((feed) => {
            const previewHtml = feed.previewComments.map(renderCommentHtml).join('');
            return `
              <div class="feed-card" data-feed-id="${feed.id}" data-expanded="false">
                <div class="feed-card-head">
                  <span class="feed-type-badge ${FEED_TYPE_CLASS[feed.type]}">${FEED_TYPE_LABEL[feed.type]}</span>
                  <span class="feed-card-time">${formatFeedTime(feed.publishAt)}</span>
                </div>
                <div class="feed-card-content">${escapeHtml(feed.content)}</div>
                ${feed.pointReward > 0 ? `<div class="feed-reward-note">💬 댓글 작성 시 +${feed.pointReward}P</div>` : ''}
                <div class="feed-comments">${previewHtml || '<p class="view-muted">아직 댓글이 없어요.</p>'}</div>
                <div class="feed-compose-row">
                  <input type="text" class="memo-input feed-comment-input" placeholder="댓글 달기..." maxlength="300" />
                  <button type="button" class="view-btn feed-comment-submit">등록</button>
                </div>
              </div>`;
          })
          .join('')
      : '<p class="view-muted view-placeholder">아직 등록된 피드가 없어요.</p>';

    winBody.innerHTML = `<div class="feed-list">${feedsHtml}</div>`;

    document.querySelectorAll('.feed-card').forEach((card) => {
      const feedId = card.dataset.feedId;
      bindCommentActions(card, feedId);

      const submit = async () => {
        const input = card.querySelector('.feed-comment-input');
        const content = input.value.trim();
        if (!content) return;
        try {
          const cres = await fetch(`/api/feeds/${feedId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          const cdata = await cres.json();
          if (!cres.ok) {
            alert(cdata.error || '댓글 작성에 실패했어요.');
            return;
          }
          input.value = '';
          renderFeedView();
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
        }
      };
      card.querySelector('.feed-comment-submit').addEventListener('click', submit);
      card.querySelector('.feed-comment-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });

      // 카드 자체를 누르면(입력창/버튼/삭제/열람 클릭이 아닌 경우) 댓글 펼치기/접기
      card.addEventListener('click', (e) => {
        if (e.target.closest('input, button, .feed-comment-delete, .feed-unlock-btn')) return;
        toggleFeedComments(feedId, feedsById[feedId]);
      });
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">피드를 불러오지 못했어요.</p>';
  }
}

const SHOP_TYPE_LABEL = { gift: '선물', anon_note: '익명 쪽지', mp3: 'mp3', magnifier: '돋보기', pass: '열람권', coin: '동전', nameplate: '이름표', gacha: '뽑기' };

function shopItemNeedsRecipient(type) {
  return type === 'gift' || type === 'anon_note' || type === 'mp3' || type === 'coin';
}

async function buildGachaAdminHtml() {
  try {
    const res = await fetch('/api/admin/gacha/prizes');
    const { prizes } = await res.json();

    const totalWeight = prizes.filter((p) => p.active).reduce((s, p) => s + p.weight, 0);
    const prizesHtml = prizes.length
      ? prizes
          .map((p) => {
            const pct = totalWeight > 0 && p.active ? ((p.weight / totalWeight) * 100).toFixed(1) : '0';
            return `
              <div class="member-row">
                <div class="member-info">
                  <span class="member-nick">${escapeHtml(p.name)}</span>
                  <span class="pref-badge pref-top">${p.active ? pct + '%' : '비활성'}</span>
                </div>
                <div class="member-note">가중치 ${p.weight} · ${p.point_reward}P</div>
                <button type="button" class="poke-btn gacha-toggle-btn" data-prize-id="${p.id}" data-enabled="${p.active ? '0' : '1'}">${p.active ? '끄기' : '켜기'}</button>
              </div>`;
          })
          .join('')
      : '<p class="view-muted">아직 등록된 상품이 없어요.</p>';

    return `
      <div class="feed-admin-compose" style="margin-top:20px;">
        <div class="feed-admin-compose-title">🎰 뽑기판 관리 (관리자)</div>
        <input type="text" id="gacha-new-name" class="xp-input" placeholder="상품 이름 (예: 꽝, 커플 카세트)" />
        <div class="feed-admin-compose-row" style="margin-top:6px;">
          <label>확률 가중치 <input type="number" id="gacha-new-weight" min="1" value="1" class="feed-num-input" /></label>
          <label>지급 포인트 <input type="number" id="gacha-new-points" min="0" value="0" class="feed-num-input" /></label>
        </div>
        <p id="gacha-new-error" class="xp-error hidden"></p>
        <button type="button" id="gacha-new-submit" class="view-btn" style="margin-top:8px;">상품 등록</button>
        <div class="shop-section-title" style="margin-top:14px;">현재 상품 목록</div>
        <div class="member-list">${prizesHtml}</div>
      </div>`;
  } catch (err) {
    return '';
  }
}

function bindGachaAdmin(refreshFn) {
  const refresh = refreshFn || renderAdminShopTab;
  const submitBtn = document.getElementById('gacha-new-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const errorEl = document.getElementById('gacha-new-error');
      errorEl.classList.add('hidden');
      const name = document.getElementById('gacha-new-name').value.trim();
      const weight = parseInt(document.getElementById('gacha-new-weight').value, 10) || 0;
      const pointReward = parseInt(document.getElementById('gacha-new-points').value, 10) || 0;
      if (!name) {
        errorEl.textContent = '상품 이름을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      const r = await fetch('/api/admin/gacha/prizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, weight, pointReward }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '등록에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      refresh();
    });
  }
  document.querySelectorAll('.gacha-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/api/admin/gacha/prizes/${btn.dataset.prizeId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: btn.dataset.enabled === '1' }),
      });
      refresh();
    });
  });
}

async function renderShopView() {
  winTitleText.textContent = '알씨 - 상점';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const [itemsRes, membersRes, invRes, meRes, gachaRes] = await Promise.all([
      fetch('/api/shop/items'),
      fetch('/api/members'),
      fetch('/api/shop/inventory'),
      fetch('/api/points/me'),
      fetch('/api/shop/gacha/history'),
    ]);
    if (!itemsRes.ok || !membersRes.ok || !invRes.ok) throw new Error('load-failed');
    const { items } = await itemsRes.json();
    const { members } = await membersRes.json();
    const { received, magnifierCount } = await invRes.json();
    const { points: myPoints } = await meRes.json();
    const { draws: myDraws } = gachaRes.ok ? await gachaRes.json() : { draws: [] };

    const memberOptions = members
      .filter((m) => m.nickname !== currentUser.nickname)
      .map((m) => `<option value="${escapeHtml(m.nickname)}">${escapeHtml(m.nickname)}</option>`)
      .join('');

    const itemsHtml = items.length
      ? items
          .map(
            (item) => `
            <div class="shop-item-card">
              <div class="shop-item-icon">${item.icon || '🎁'}</div>
              <div class="shop-item-info">
                <div class="shop-item-name">${escapeHtml(item.name)}</div>
                <div class="shop-item-price">💰 ${item.price}P</div>
              </div>
              <button type="button" class="view-btn shop-buy-btn" data-item-id="${item.id}" data-item-type="${item.type}">구매</button>
            </div>`
          )
          .join('')
      : '<p class="view-muted">등록된 아이템이 없어요.</p>';

    const receivedHtml = received.length
      ? received
          .map((r) => {
            const senderLabel = r.revealed
              ? `보낸 사람: ${escapeHtml(r.senderNickname)}`
              : magnifierCount > 0
              ? `<button type="button" class="feed-unlock-btn shop-reveal-btn" data-target-id="${r.id}">🔍 돋보기로 보낸 사람 보기</button>`
              : '보낸 사람: ??? (돋보기 필요)';
            const extra = r.type === 'anon_note' && r.message ? `<div class="shop-received-message">"${escapeHtml(r.message)}"</div>` : '';
            const mp3Extra = r.type === 'mp3' && r.extraData ? `<div class="shop-received-message">🎵 ${escapeHtml(r.extraData.fileName)} (소리바다에 등록됨)</div>` : '';
            return `
              <div class="shop-received-row">
                <div class="shop-received-head">
                  <span class="shop-received-type">${SHOP_TYPE_LABEL[r.type] || r.type}: ${escapeHtml(r.itemName)}</span>
                  <span class="feed-card-time">${formatFeedTime(r.createdAt)}</span>
                </div>
                ${extra}${mp3Extra}
                <div class="shop-received-sender">${senderLabel}</div>
              </div>`;
          })
          .join('')
      : '<p class="view-muted">아직 받은 아이템이 없어요.</p>';

    winBody.innerHTML = `
      <div class="shop-header">
        <span>💰 내 포인트: <strong>${myPoints}P</strong></span>
        <span>🔍 보유 돋보기: <strong>${magnifierCount}개</strong></span>
      </div>
      <div class="shop-section-title">아이템</div>
      <div class="shop-item-list">${itemsHtml}</div>

      <div class="shop-purchase-panel hidden" id="shop-purchase-panel">
        <div class="shop-purchase-title" id="shop-purchase-title"></div>
        <div id="shop-purchase-fields"></div>
        <p id="shop-purchase-error" class="xp-error hidden"></p>
        <div class="shop-purchase-actions">
          <button type="button" id="shop-purchase-confirm" class="view-btn">전송하기</button>
          <button type="button" id="shop-purchase-cancel" class="ghost-btn-shop">취소</button>
        </div>
      </div>

      <div class="shop-section-title">받은 아이템</div>
      <div class="shop-received-list">${receivedHtml}</div>

      <div class="shop-section-title" style="margin-top:16px;">🎰 내 뽑기 내역</div>
      <div class="shop-received-list">${
        myDraws.length
          ? myDraws
              .map(
                (d) => `
              <div class="shop-received-row">
                <div class="shop-received-head">
                  <span class="shop-received-type">${escapeHtml(d.prize_name)}${d.point_reward > 0 ? ` (+${d.point_reward}P)` : ''}</span>
                  <span class="feed-card-time">${formatFeedTime(d.created_at)}</span>
                </div>
              </div>`
              )
              .join('')
          : '<p class="view-muted">아직 뽑은 적 없어요.</p>'
      }</div>
    `;

    let selectedItem = null;
    const panel = document.getElementById('shop-purchase-panel');
    const fieldsEl = document.getElementById('shop-purchase-fields');
    const titleEl = document.getElementById('shop-purchase-title');
    const errorEl = document.getElementById('shop-purchase-error');

    document.querySelectorAll('.shop-buy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const itemId = btn.dataset.itemId;
        const type = btn.dataset.itemType;
        selectedItem = items.find((i) => String(i.id) === itemId);
        titleEl.textContent = `${selectedItem.icon || ''} ${selectedItem.name} 보내기 (${selectedItem.price}P)`;
        errorEl.classList.add('hidden');

        let fieldsHtml = '';
        if (shopItemNeedsRecipient(type)) {
          fieldsHtml += `
            <select id="shop-to" class="soribada-select">
              <option value="">받는 사람 선택</option>
              ${memberOptions}
            </select>`;
        }
        if (type === 'anon_note') {
          fieldsHtml += `
            <input type="text" id="shop-message" class="xp-input" placeholder="쪽지 내용" style="margin-top:6px;" />
            <div id="shop-message-count" class="shop-char-count">0/30</div>`;
        }
        if (type === 'mp3') {
          fieldsHtml += `
            <input type="text" id="shop-mp3-title" class="xp-input" placeholder="제목 (띄어쓰기 없이 8글자)" maxlength="8" style="margin-top:6px;" />
            <input type="text" id="shop-mp3-url" class="xp-input" placeholder="유튜브 링크" style="margin-top:6px;" />`;
        }
        if (type === 'magnifier' || type === 'pass' || type === 'nameplate') {
          fieldsHtml += `<p class="view-muted">내가 사용할 아이템이에요. 구매하면 바로 보유 개수에 추가돼요.</p>`;
        }
        if (type === 'coin') {
          fieldsHtml += `<p class="view-muted">선택한 회원의 취향표를 열람할 수 있게 돼요.</p>`;
        }
        if (type === 'gacha') {
          fieldsHtml += `<p class="view-muted">구매하는 즉시 바로 뽑기 결과가 나와요!</p>`;
        }
        fieldsEl.innerHTML = fieldsHtml;
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        if (type === 'anon_note') {
          const msgInput = document.getElementById('shop-message');
          const countEl = document.getElementById('shop-message-count');
          msgInput.addEventListener('input', () => {
            const noSpaceLength = msgInput.value.replace(/\s/g, '').length;
            countEl.textContent = `${noSpaceLength}/30`;
            countEl.classList.toggle('over-limit', noSpaceLength > 30);
          });
        }
      });
    });

    document.getElementById('shop-purchase-cancel').addEventListener('click', () => {
      panel.classList.add('hidden');
    });

    document.getElementById('shop-purchase-confirm').addEventListener('click', async () => {
      if (!selectedItem) return;
      errorEl.classList.add('hidden');

      const body = { itemId: selectedItem.id };
      if (shopItemNeedsRecipient(selectedItem.type)) {
        const toEl = document.getElementById('shop-to');
        if (!toEl.value) {
          errorEl.textContent = '받는 사람을 선택해 주세요.';
          errorEl.classList.remove('hidden');
          return;
        }
        body.toNickname = toEl.value;
      }
      if (selectedItem.type === 'anon_note') {
        body.message = document.getElementById('shop-message').value.trim();
        if (!body.message) {
          errorEl.textContent = '쪽지 내용을 입력해 주세요.';
          errorEl.classList.remove('hidden');
          return;
        }
        const noSpaceLength = body.message.replace(/\s/g, '').length;
        if (noSpaceLength > 30) {
          errorEl.textContent = '쪽지는 공백 제외 30자를 넘을 수 없어요.';
          errorEl.classList.remove('hidden');
          return;
        }
      }
      if (selectedItem.type === 'mp3') {
        body.mp3Title = document.getElementById('shop-mp3-title').value.trim();
        body.mp3YoutubeUrl = document.getElementById('shop-mp3-url').value.trim();
        if (!body.mp3Title || !body.mp3YoutubeUrl) {
          errorEl.textContent = '제목과 유튜브 링크를 모두 입력해 주세요.';
          errorEl.classList.remove('hidden');
          return;
        }
      }

      try {
        const res = await fetch('/api/shop/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          errorEl.textContent = data.error || '구매에 실패했어요.';
          errorEl.classList.remove('hidden');
          return;
        }
        if (data.gachaResult) {
          const r = data.gachaResult;
          alert(r.pointReward > 0 ? `🎉 "${r.prizeName}" 당첨! +${r.pointReward}P 지급됐어요.` : `😅 "${r.prizeName}"... 다음 기회에!`);
        }
        renderShopView();
      } catch (err) {
        errorEl.textContent = '서버에 연결할 수 없어요.';
        errorEl.classList.remove('hidden');
      }
    });

    document.querySelectorAll('.shop-reveal-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/api/shop/reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetPurchaseId: Number(btn.dataset.targetId) }),
          });
          const data = await res.json();
          if (!res.ok) {
            alert(data.error || '공개에 실패했어요.');
            btn.disabled = false;
            return;
          }
          renderShopView();
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">상점을 불러오지 못했어요.</p>';
  }
}

/* ===== msn (블라인드) ===== */
let msnSubTab = 'topics'; // 'topics' | 'threads'

function formatMsnTime(iso) {
  if (!iso) return '';
  return iso.slice(5, 16);
}

function msnNavHtml() {
  return `
    <div class="msn-nav">
      <button type="button" class="msn-nav-btn ${msnSubTab === 'topics' ? 'active' : ''}" id="msn-nav-topics">주제</button>
      <button type="button" class="msn-nav-btn ${msnSubTab === 'threads' ? 'active' : ''}" id="msn-nav-threads">내 대화</button>
    </div>`;
}

function bindMsnNav() {
  document.getElementById('msn-nav-topics').addEventListener('click', () => {
    msnSubTab = 'topics';
    renderMsnView();
  });
  document.getElementById('msn-nav-threads').addEventListener('click', () => {
    msnSubTab = 'threads';
    renderMsnView();
  });
}

async function renderMsnView() {
  winTitleText.textContent = 'msn - 블라인드';
  if (msnSubTab === 'threads') return renderMsnThreadsTab();
  return renderMsnTopicsTab();
}

async function renderMsnTopicsTab() {
  winBody.innerHTML = msnNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindMsnNav();
  try {
    const res = await fetch('/api/msn/topics');
    if (!res.ok) throw new Error('load-failed');
    const { topics } = await res.json();

    const topicsHtml = topics.length
      ? topics
          .map((t) => {
            const shareBadge = t.sharingEnabled
              ? '<span class="msn-share-badge on">공유 중</span>'
              : '<span class="msn-share-badge off">공유 대기</span>';

            let bodyHtml;
            if (!t.hasAnswered) {
              bodyHtml = `
                <div class="msn-answer-compose">
                  <input type="text" class="memo-input msn-answer-input" placeholder="이 주제에 익명으로 답변하기..." maxlength="300" />
                  <button type="button" class="view-btn msn-answer-submit" data-topic-id="${t.id}">제출</button>
                </div>`;
            } else if (t.sharingEnabled) {
              bodyHtml = `
                <div class="msn-answered-note">✅ 답변 완료 · 말 걸기 ${t.threadsRemaining}/${3}회 남음</div>
                <div class="msn-answers-toggle" data-topic-id="${t.id}">💬 다른 사람 답변 보기</div>
                <div class="msn-answers-wrap" id="msn-answers-${t.id}"></div>`;
            } else {
              bodyHtml = `<div class="msn-answered-note">✅ 답변 완료 · 관리자가 공유를 켜면 서로 볼 수 있어요</div>`;
            }

            return `
              <div class="feed-card msn-topic-card">
                <div class="feed-card-head">
                  ${shareBadge}
                  <span class="feed-card-time">${formatMsnTime(t.createdAt)}</span>
                </div>
                <div class="feed-card-content">${escapeHtml(t.content)}</div>
                <div class="msn-meta">답변 ${t.answerCount}개</div>
                ${bodyHtml}
              </div>`;
          })
          .join('')
      : '<p class="view-muted view-placeholder">아직 등록된 주제가 없어요.</p>';

    winBody.innerHTML = msnNavHtml() + `<div class="feed-list">${topicsHtml}</div>`;
    bindMsnNav();

    document.querySelectorAll('.msn-answer-submit').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const card = btn.closest('.msn-topic-card');
        const input = card.querySelector('.msn-answer-input');
        const content = input.value.trim();
        if (!content) return;
        try {
          const r = await fetch(`/api/msn/topics/${btn.dataset.topicId}/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          const d = await r.json();
          if (!r.ok) return alert(d.error || '제출에 실패했어요.');
          renderMsnTopicsTab();
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
        }
      });
    });

    document.querySelectorAll('.msn-answers-toggle').forEach((el) => {
      el.addEventListener('click', () => toggleMsnAnswers(el.dataset.topicId));
    });
  } catch (err) {
    winBody.innerHTML = msnNavHtml() + '<p class="view-msg">주제를 불러오지 못했어요.</p>';
    bindMsnNav();
  }
}

async function toggleMsnAnswers(topicId) {
  const wrap = document.getElementById(`msn-answers-${topicId}`);
  if (!wrap) return;
  if (wrap.dataset.loaded === 'true') {
    wrap.innerHTML = '';
    wrap.dataset.loaded = 'false';
    return;
  }
  wrap.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch(`/api/msn/topics/${topicId}/answers`);
    const data = await res.json();
    if (!data.canView) {
      wrap.innerHTML = '<p class="view-muted">아직 볼 수 없어요.</p>';
      return;
    }
    wrap.innerHTML = data.answers
      .map((a) => {
        if (a.isOwn) {
          return `<div class="msn-answer-row own"><span class="msn-answer-tag">내 답변</span><div class="msn-answer-text">${escapeHtml(a.content)}</div></div>`;
        }
        const actionHtml = a.hasThread
          ? '<span class="msn-already-tag">이미 말 걸었어요</span>'
          : `<button type="button" class="feed-unlock-btn msn-talk-btn" data-topic-id="${topicId}" data-answer-id="${a.id}">말 걸기</button>`;
        return `
          <div class="msn-answer-row">
            <div class="msn-answer-text">${escapeHtml(a.content)}</div>
            <div class="msn-answer-compose-slot" id="msn-talk-slot-${a.id}">${actionHtml}</div>
          </div>`;
      })
      .join('');
    wrap.dataset.loaded = 'true';

    wrap.querySelectorAll('.msn-talk-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = document.getElementById(`msn-talk-slot-${btn.dataset.answerId}`);
        slot.innerHTML = `
          <input type="text" class="memo-input msn-first-message" placeholder="첫 메시지를 보내보세요..." maxlength="300" />
          <button type="button" class="view-btn msn-first-send" data-topic-id="${btn.dataset.topicId}" data-answer-id="${btn.dataset.answerId}">보내기</button>`;
        slot.querySelector('.msn-first-send').addEventListener('click', async () => {
          const input = slot.querySelector('.msn-first-message');
          const message = input.value.trim();
          if (!message) return;
          try {
            const r = await fetch(`/api/msn/topics/${btn.dataset.topicId}/threads`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answerId: Number(btn.dataset.answerId), message }),
            });
            const d = await r.json();
            if (!r.ok) return alert(d.error || '실패했어요.');
            msnSubTab = 'threads';
            renderMsnView();
          } catch (err) {
            alert('서버에 연결할 수 없어요.');
          }
        });
      });
    });
  } catch (err) {
    wrap.innerHTML = '<p class="view-msg">불러오지 못했어요.</p>';
  }
}

async function renderMsnThreadsTab() {
  winBody.innerHTML = msnNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindMsnNav();
  try {
    const res = await fetch('/api/msn/threads');
    if (!res.ok) throw new Error('load-failed');
    const { threads } = await res.json();

    const listHtml = threads.length
      ? threads
          .map((t) => {
            const roleLabel = t.role === 'owner' ? '내 답변에 온 대화' : '내가 먼저 건 대화';
            const nameLabel = t.revealed ? escapeHtml(t.counterpartNickname) : '??? (비공개)';
            const statusLabel = t.exhausted ? '대화 종료' : `내 차례 ${t.myTurnsUsed}/${t.myTurnsMax}`;
            return `
              <div class="member-row msn-thread-row" data-thread-id="${t.id}">
                <div class="member-info">
                  <span class="member-nick">${nameLabel}</span>
                  <span class="pref-badge pref-top">${roleLabel}</span>
                </div>
                <div class="member-note">${statusLabel} · 메시지 ${t.messageCount}개</div>
              </div>`;
          })
          .join('')
      : '<p class="view-muted view-placeholder">아직 대화가 없어요. "주제" 탭에서 다른 사람 답변에 말을 걸어보세요.</p>';

    winBody.innerHTML = msnNavHtml() + `<div class="member-list">${listHtml}</div>`;
    bindMsnNav();

    document.querySelectorAll('.msn-thread-row').forEach((row) => {
      row.addEventListener('click', () => renderMsnThreadChat(row.dataset.threadId));
    });
  } catch (err) {
    winBody.innerHTML = msnNavHtml() + '<p class="view-msg">대화 목록을 불러오지 못했어요.</p>';
    bindMsnNav();
  }
}

async function renderMsnThreadChat(threadId) {
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch(`/api/msn/threads/${threadId}`);
    if (!res.ok) throw new Error('load-failed');
    const data = await res.json();

    const messagesHtml = data.messages
      .map((m) => `<div class="msn-msg ${m.isMine ? 'mine' : 'theirs'}">${escapeHtml(m.content)}</div>`)
      .join('');

    const nameLabel = data.revealed ? escapeHtml(data.counterpartNickname) : '??? (비공개 상대)';

    const revealHtml =
      data.exhausted && !data.revealed
        ? `<button type="button" class="feed-unlock-btn" id="msn-reveal-btn">🔍 열람권으로 상대 공개하기</button>`
        : '';

    const composeHtml =
      data.myTurnsRemaining > 0
        ? `
        <div class="feed-compose-row">
          <input type="text" class="memo-input" id="msn-chat-input" placeholder="메시지 보내기... (남은 ${data.myTurnsRemaining}회)" maxlength="300" />
          <button type="button" class="view-btn" id="msn-chat-send">전송</button>
        </div>`
        : `<p class="view-muted" style="text-align:center;">${data.exhausted ? '대화 기회를 모두 사용했어요.' : ''}</p>`;

    winBody.innerHTML = `
      <div class="msn-chat-header">
        <span class="msn-chat-back" id="msn-chat-back">← 목록으로</span>
        <span>${nameLabel}</span>
      </div>
      <div class="msn-chat-messages">${messagesHtml}</div>
      ${revealHtml}
      <p id="msn-chat-error" class="xp-error hidden"></p>
      ${composeHtml}
    `;

    document.getElementById('msn-chat-back').addEventListener('click', renderMsnThreadsTab);

    const sendBtn = document.getElementById('msn-chat-send');
    if (sendBtn) {
      const send = async () => {
        const input = document.getElementById('msn-chat-input');
        const content = input.value.trim();
        if (!content) return;
        try {
          const r = await fetch(`/api/msn/threads/${threadId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
          });
          const d = await r.json();
          if (!r.ok) {
            document.getElementById('msn-chat-error').textContent = d.error || '전송 실패';
            document.getElementById('msn-chat-error').classList.remove('hidden');
            return;
          }
          renderMsnThreadChat(threadId);
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
        }
      };
      sendBtn.addEventListener('click', send);
      document.getElementById('msn-chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send();
      });
    }

    const revealBtn = document.getElementById('msn-reveal-btn');
    if (revealBtn) {
      revealBtn.addEventListener('click', async () => {
        revealBtn.disabled = true;
        try {
          const r = await fetch(`/api/msn/threads/${threadId}/reveal`, { method: 'POST' });
          const d = await r.json();
          if (!r.ok) {
            alert(d.error || '공개에 실패했어요.');
            revealBtn.disabled = false;
            return;
          }
          renderMsnThreadChat(threadId);
        } catch (err) {
          alert('서버에 연결할 수 없어요.');
          revealBtn.disabled = false;
        }
      });
    }
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">대화를 불러오지 못했어요.</p>';
  }
}

/* ===== 취향표 ===== */

function renderAnswerFieldHtml(a) {
  if (a.questionType === 'radio') {
    const optionsHtml = a.options
      .map(
        (opt) => `
        <label class="taste-option-label">
          <input type="radio" name="taste-q-${a.questionId}" value="${escapeHtml(opt)}" ${a.answerText === opt ? 'checked' : ''} />
          ${escapeHtml(opt)}
        </label>`
      )
      .join('');
    return `<div class="taste-options-wrap" data-question-id="${a.questionId}" data-question-type="radio">${optionsHtml}</div>`;
  }
  if (a.questionType === 'checkbox') {
    let selected = [];
    try { selected = a.answerText ? JSON.parse(a.answerText) : []; } catch (err) { selected = []; }
    const optionsHtml = a.options
      .map(
        (opt) => `
        <label class="taste-option-label">
          <input type="checkbox" value="${escapeHtml(opt)}" ${selected.includes(opt) ? 'checked' : ''} />
          ${escapeHtml(opt)}
        </label>`
      )
      .join('');
    return `<div class="taste-options-wrap" data-question-id="${a.questionId}" data-question-type="checkbox">${optionsHtml}</div>`;
  }
  return `<textarea class="memo-input taste-answer-input" data-question-id="${a.questionId}" data-question-type="text" maxlength="500" placeholder="답변을 적어보세요">${escapeHtml(a.answerText)}</textarea>`;
}

function renderAnswerDisplayHtml(a) {
  if (a.questionType === 'checkbox') {
    let selected = [];
    try { selected = a.answerText ? JSON.parse(a.answerText) : []; } catch (err) { selected = []; }
    return escapeHtml(selected.length ? selected.join(', ') : '(답변 없음)');
  }
  return escapeHtml(a.answerText || '(답변 없음)');
}

function collectAnswersFromForm() {
  const payload = [];
  document.querySelectorAll('.taste-answer-input').forEach((el) => {
    payload.push({ questionId: Number(el.dataset.questionId), answerText: el.value });
  });
  document.querySelectorAll('.taste-options-wrap').forEach((wrap) => {
    const questionId = Number(wrap.dataset.questionId);
    if (wrap.dataset.questionType === 'radio') {
      const checked = wrap.querySelector('input[type="radio"]:checked');
      payload.push({ questionId, answerText: checked ? checked.value : '' });
    } else {
      const checked = Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked')).map((c) => c.value);
      payload.push({ questionId, answerText: checked.length ? JSON.stringify(checked) : '' });
    }
  });
  return payload;
}

const TASTE_TYPE_LABEL = { text: '서술형', radio: '라디오(단일 선택)', checkbox: '체크박스(복수 선택)' };

async function renderTasteView() {
  winTitleText.textContent = '취향표';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch('/api/taste/me');
    if (!res.ok) throw new Error('load-failed');
    const { answers } = await res.json();

    const questionsHtml = answers.length
      ? answers
          .map(
            (a) => `
            <div class="taste-question-row">
              <div class="taste-question-text">${escapeHtml(a.questionText)}</div>
              ${renderAnswerFieldHtml(a)}
            </div>`
          )
          .join('')
      : '<p class="view-muted">아직 등록된 질문이 없어요.</p>';

    winBody.innerHTML = `
      <div class="shop-section-title">내 취향표 작성</div>
      <p class="view-muted" style="margin-bottom:10px;">여기 적은 내용은 아무 데도 안 보여요. 누군가 상점에서 동전으로 나를 지목해 구매해야만 볼 수 있어요.</p>
      <div class="taste-question-list">${questionsHtml}</div>
      <p id="taste-save-msg" class="view-msg hidden"></p>
      <button type="button" id="taste-save-btn" class="view-btn" style="margin-top:8px;">저장</button>

      <div class="shop-section-title" style="margin-top:20px;">다른 회원 취향표 보기</div>
      <div class="soribada-compose">
        <div class="soribada-compose-row">
          <input type="text" id="taste-view-nickname" class="xp-input" placeholder="닉네임 입력" />
        </div>
        <button type="button" id="taste-view-btn" class="view-btn">보기</button>
        <div id="taste-view-result" style="margin-top:10px;"></div>
      </div>
    `;

    document.getElementById('taste-save-btn').addEventListener('click', async () => {
      const msgEl = document.getElementById('taste-save-msg');
      msgEl.classList.add('hidden');
      const answersPayload = collectAnswersFromForm();
      try {
        const r = await fetch('/api/taste/me', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: answersPayload }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || '저장 실패');
        msgEl.textContent = '저장했어요!';
        msgEl.classList.remove('hidden');
      } catch (err) {
        msgEl.textContent = err.message || '저장에 실패했어요.';
        msgEl.classList.remove('hidden');
      }
    });

    document.getElementById('taste-view-btn').addEventListener('click', async () => {
      const nickname = document.getElementById('taste-view-nickname').value.trim();
      const resultEl = document.getElementById('taste-view-result');
      if (!nickname) return;
      resultEl.innerHTML = '<p class="view-loading">불러오는 중...</p>';
      try {
        const r = await fetch(`/api/taste/${encodeURIComponent(nickname)}`);
        if (!r.ok) {
          resultEl.innerHTML = `<p class="view-msg">${r.status === 404 ? '회원을 찾을 수 없어요.' : '불러오지 못했어요.'}</p>`;
          return;
        }
        const d = await r.json();
        if (!d.canView) {
          resultEl.innerHTML = '<p class="view-muted">🔒 동전을 사용해야 볼 수 있어요. (알씨 상점에서 구매)</p>';
          return;
        }
        resultEl.innerHTML = d.answers.length
          ? d.answers
              .map(
                (a) => `
                <div class="taste-question-row">
                  <div class="taste-question-text">${escapeHtml(a.questionText)}</div>
                  <div class="feed-comment-content">${renderAnswerDisplayHtml(a)}</div>
                </div>`
              )
              .join('')
          : '<p class="view-muted">아직 작성된 답변이 없어요.</p>';
      } catch (err) {
        resultEl.innerHTML = '<p class="view-msg">서버에 연결할 수 없어요.</p>';
      }
    });
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">취향표를 불러오지 못했어요.</p>';
  }
}

/* ===== 교환일기 ===== */

const DIARY_RESULT_MESSAGE = {
  both_correct: '🎉 서로 정확히 맞혔어요!',
  one_correct: '😢 아쉽게도 한 명만 맞혔어요.',
  both_wrong: '❌ 둘 다 틀렸어요.',
};

async function renderDiaryView() {
  winTitleText.textContent = '교환일기';
  winBody.innerHTML = '<p class="view-loading">불러오는 중...</p>';
  try {
    const res = await fetch('/api/diary/me');
    if (!res.ok) throw new Error('load-failed');
    const status = await res.json();

    if (status.status === 'not_applied') {
      winBody.innerHTML = `
        <div class="view-placeholder" style="margin-top:3rem; text-align:center;">
          <p class="view-muted" style="margin-bottom:14px;">참여하면 관리자가 비밀친구를 정해줘요.<br>서로 누군지 모른 채 장(章)마다 주어진 주제로 일기를 주고받게 돼요.</p>
          <button type="button" id="diary-apply-btn" class="view-btn">참여 신청하기</button>
        </div>`;
      document.getElementById('diary-apply-btn').addEventListener('click', async () => {
        const r = await fetch('/api/diary/apply', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '신청에 실패했어요.');
        renderDiaryView();
      });
      return;
    }

    if (status.status === 'applied') {
      winBody.innerHTML = `
        <div class="view-placeholder" style="margin-top:3rem; text-align:center;">
          <p class="view-muted" style="margin-bottom:14px;">✅ 신청 완료! 관리자가 비밀친구를 정해줄 때까지 기다려주세요.</p>
          <button type="button" id="diary-cancel-btn" class="ghost-btn-shop">신청 취소</button>
        </div>`;
      document.getElementById('diary-cancel-btn').addEventListener('click', async () => {
        const r = await fetch('/api/diary/apply', { method: 'DELETE' });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '취소에 실패했어요.');
        renderDiaryView();
      });
      return;
    }

    // paired
    const chaptersRes = await fetch('/api/diary/chapters');
    const { chapters } = await chaptersRes.json();
    const finished = status.eventState.finished;
    const guessingOpen = status.eventState.guessingOpen;

    const partnerLabel = status.revealed
      ? `💌 비밀친구: <strong>${escapeHtml(status.partnerNickname)}</strong>`
      : `💌 비밀친구: ??? ${finished ? '' : '<button type="button" id="diary-reveal-btn" class="feed-unlock-btn" style="margin-left:6px;">이름표로 공개</button>'}`;

    const chaptersHtml = chapters.length
      ? chapters
          .map((c) => {
            const myBox = c.editable
              ? `<textarea class="memo-input diary-chapter-input" data-chapter-id="${c.chapterId}" maxlength="2000" placeholder="답장을 적어보세요...">${escapeHtml(c.myEntry ? c.myEntry.content : '')}</textarea>
                 <button type="button" class="view-btn diary-chapter-save" data-chapter-id="${c.chapterId}" style="margin-top:6px;">저장</button>`
              : c.myEntry
              ? `<div class="feed-comment-content">${escapeHtml(c.myEntry.content)}</div>`
              : '<p class="view-muted">이 장에는 답장을 쓰지 않았어요.</p>';

            const partnerBox = c.partnerEntry
              ? `<div class="feed-comment-content">${escapeHtml(c.partnerEntry.content)}</div>`
              : '<p class="view-muted">비밀친구가 아직 안 썼어요.</p>';

            return `
              <div class="taste-question-row">
                <div class="taste-question-text">${c.chapterNumber}장. ${escapeHtml(c.topicText)}</div>
                <div class="diary-chapter-col">
                  <div class="diary-chapter-label">내 답장 ${c.editable ? '(수정 가능)' : ''}</div>
                  ${myBox}
                </div>
                <div class="diary-chapter-col" style="margin-top:10px;">
                  <div class="diary-chapter-label">💌 비밀친구의 답장</div>
                  ${partnerBox}
                </div>
              </div>`;
          })
          .join('')
      : '<p class="view-muted">아직 관리자가 주제를 등록하지 않았어요.</p>';

    // 추측 섹션
    let guessHtml = '';
    if (guessingOpen || status.guessResult) {
      if (status.guessResult) {
        guessHtml = `
          <div class="shop-header"><span>${DIARY_RESULT_MESSAGE[status.guessResult] || ''}</span></div>`;
      } else if (status.guessSubmitted) {
        guessHtml = `<p class="view-muted">추측을 제출했어요. 비밀친구도 추측을 제출하면 결과가 나와요.</p>`;
      } else if (!finished) {
        guessHtml = `
          <div class="shop-section-title">🔍 비밀친구 추측하기 (딱 한 번만 가능해요)</div>
          <div class="soribada-compose">
            <select id="diary-guess-select" class="soribada-select"><option value="">참가자 선택</option></select>
            <button type="button" id="diary-guess-submit" class="view-btn" style="margin-top:8px;">추측 제출</button>
            <p id="diary-guess-error" class="xp-error hidden"></p>
          </div>`;
      }
    }

    // 마지막 장 (자유 대화)
    let finalHtml = '';
    if (status.finalUnlocked) {
      const finalRes = await fetch('/api/diary/final');
      const { entries: finalEntries } = await finalRes.json();
      const finalEntriesHtml = finalEntries.length
        ? finalEntries
            .map(
              (e) => `<div class="diary-entry ${e.isMine ? '' : 'partner'}">
                <div class="diary-entry-content">${escapeHtml(e.content)}</div>
                <div class="feed-card-time">${formatFeedTime(e.createdAt)}</div>
              </div>`
            )
            .join('')
        : '<p class="view-muted">아직 아무도 안 썼어요.</p>';

      finalHtml = `
        <div class="shop-section-title" style="margin-top:20px;">✨ 마지막 장 (자유롭게 대화하기)</div>
        <div class="diary-entry-list">${finalEntriesHtml}</div>
        ${
          finished
            ? ''
            : `<div class="feed-compose-row" style="margin-top:8px;">
                <input type="text" id="diary-final-input" class="memo-input" maxlength="2000" placeholder="자유롭게 적어보세요..." />
                <button type="button" id="diary-final-submit" class="view-btn">등록</button>
              </div>`
        }`;
    }

    winBody.innerHTML = `
      <div class="shop-header"><span>${partnerLabel}</span></div>
      ${finished ? '<p class="view-muted" style="margin-bottom:10px;">📕 교환일기가 종료됐어요. 이제 읽기만 가능해요.</p>' : ''}
      <div class="shop-section-title">장별 주제</div>
      <div class="taste-question-list">${chaptersHtml}</div>
      ${guessHtml}
      ${finalHtml}
    `;

    // 장별 저장
    winBody.querySelectorAll('.diary-chapter-save').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const chapterId = btn.dataset.chapterId;
        const input = winBody.querySelector(`.diary-chapter-input[data-chapter-id="${chapterId}"]`);
        const content = input.value.trim();
        if (!content) return;
        const r = await fetch(`/api/diary/chapters/${chapterId}/entry`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '저장에 실패했어요.');
        renderDiaryView();
      });
    });

    // 추측 셀렉트 채우기 + 제출
    const guessSelect = document.getElementById('diary-guess-select');
    if (guessSelect) {
      fetch('/api/diary/guess/candidates')
        .then((r) => r.json())
        .then(({ candidates }) => {
          guessSelect.innerHTML =
            '<option value="">참가자 선택</option>' +
            candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.nickname)}</option>`).join('');
        });
      document.getElementById('diary-guess-submit').addEventListener('click', async () => {
        const errorEl = document.getElementById('diary-guess-error');
        errorEl.classList.add('hidden');
        const guessedUserId = guessSelect.value;
        if (!guessedUserId) return;
        if (!confirm('한 번 제출하면 다시 바꿀 수 없어요. 제출할까요?')) return;
        const r = await fetch('/api/diary/guess', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guessedUserId }),
        });
        const d = await r.json();
        if (!r.ok) {
          errorEl.textContent = d.error || '제출에 실패했어요.';
          errorEl.classList.remove('hidden');
          return;
        }
        renderDiaryView();
      });
    }

    // 마지막 장 작성
    const finalSubmit = document.getElementById('diary-final-submit');
    if (finalSubmit) {
      finalSubmit.addEventListener('click', async () => {
        const input = document.getElementById('diary-final-input');
        const content = input.value.trim();
        if (!content) return;
        const r = await fetch('/api/diary/final', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '작성에 실패했어요.');
        renderDiaryView();
      });
    }

    const revealBtn = document.getElementById('diary-reveal-btn');
    if (revealBtn) {
      revealBtn.addEventListener('click', async () => {
        revealBtn.disabled = true;
        const r = await fetch('/api/diary/reveal', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) {
          alert(d.error || '공개에 실패했어요.');
          revealBtn.disabled = false;
          return;
        }
        renderDiaryView();
      });
    }
  } catch (err) {
    winBody.innerHTML = '<p class="view-msg">교환일기를 불러오지 못했어요.</p>';
  }
}

async function buildDiaryAdminHtml(refreshFn) {
  try {
    const [appRes, pairRes, stateRes] = await Promise.all([
      fetch('/api/admin/diary/applicants'),
      fetch('/api/admin/diary/pairs'),
      fetch('/api/admin/diary/state'),
    ]);
    const { applicants } = await appRes.json();
    const { pairs } = await pairRes.json();
    const state = await stateRes.json();

    const options = applicants.map((a) => `<option value="${a.user_id}">${escapeHtml(a.nickname)}</option>`).join('');

    const pairsHtml = pairs.length
      ? pairs
          .map(
            (p) => `
            <div class="member-row">
              <div class="member-info">
                <span class="member-nick">${escapeHtml(p.a_nickname)} ↔ ${escapeHtml(p.b_nickname)}</span>
              </div>
              <div class="member-note">답장 ${p.a_entry_count}/${p.b_entry_count} · 결과 ${p.guess_result ? DIARY_RESULT_MESSAGE[p.guess_result] : '미정'}</div>
              <span class="msn-answers-toggle diary-pair-view-btn" data-pair-id="${p.id}">대화 보기</span>
              <button type="button" class="poke-btn diary-unpair-btn" data-pair-id="${p.id}">해제</button>
              <div class="msn-answers-wrap" id="adiary-detail-${p.id}" style="width:100%;"></div>
            </div>`
          )
          .join('')
      : '<p class="view-muted">아직 맺어진 짝이 없어요.</p>';

    const chaptersListHtml = state.chapters.length
      ? state.chapters.map((c) => `<div class="view-muted">${c.chapter_number}장. ${escapeHtml(c.topic_text)}</div>`).join('')
      : '<p class="view-muted">아직 등록된 장이 없어요.</p>';

    return `
      <div class="feed-admin-compose">
        <div class="feed-admin-compose-title">📝 비밀친구 짝 맺어주기 (관리자)</div>
        <p class="view-muted" style="margin-bottom:8px;">신청자: ${applicants.length}명</p>
        <div class="soribada-compose-row">
          <select id="diary-pair-a" class="soribada-select">${options}</select>
        </div>
        <div class="soribada-compose-row">
          <select id="diary-pair-b" class="soribada-select">${options}</select>
        </div>
        <p id="diary-pair-error" class="xp-error hidden"></p>
        <button type="button" id="diary-pair-submit" class="view-btn">짝 맺기</button>
        <div class="shop-section-title" style="margin-top:14px;">현재 짝 목록</div>
        <div class="member-list">${pairsHtml}</div>

        <div class="shop-section-title" style="margin-top:16px;">장(주제) 등록</div>
        ${chaptersListHtml}
        <input type="text" id="diary-new-chapter" class="xp-input" placeholder="새 장의 주제를 입력하세요" style="margin-top:8px;" />
        <button type="button" id="diary-chapter-submit" class="view-btn" style="margin-top:6px;">${state.chapters.length ? '다음 장 등록 (이전 장 자동 잠김)' : '1장 등록'}</button>

        <div class="shop-section-title" style="margin-top:16px;">진행 제어</div>
        <p class="view-muted">추측 단계: ${state.guessingOpen ? '열림' : '닫힘'} · 이벤트: ${state.finished ? '완전 종료됨' : '진행 중'}</p>
        <div class="msn-admin-actions" style="display:flex; gap:8px; margin-top:6px;">
          <button type="button" id="diary-open-guessing" class="ghost-btn-shop" ${state.guessingOpen ? 'disabled' : ''}>추측 단계 열기</button>
          <button type="button" id="diary-finish-btn" class="ghost-btn-shop" ${state.finished ? 'disabled' : ''}>완전 종료</button>
        </div>
      </div>`;
  } catch (err) {
    return '';
  }
}

function bindDiaryAdmin(refreshFn) {
  const refresh = refreshFn || renderAdminDiaryTab;
  const submitBtn = document.getElementById('diary-pair-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const errorEl = document.getElementById('diary-pair-error');
      errorEl.classList.add('hidden');
      const userIdA = document.getElementById('diary-pair-a').value;
      const userIdB = document.getElementById('diary-pair-b').value;
      if (!userIdA || !userIdB) return;
      const r = await fetch('/api/admin/diary/pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIdA, userIdB }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '짝 맺기에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      refresh();
    });
  }
  document.querySelectorAll('.diary-unpair-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 짝을 해제할까요?')) return;
      await fetch(`/api/admin/diary/pairs/${btn.dataset.pairId}`, { method: 'DELETE' });
      refresh();
    });
  });

  const chapterSubmit = document.getElementById('diary-chapter-submit');
  if (chapterSubmit) {
    chapterSubmit.addEventListener('click', async () => {
      const input = document.getElementById('diary-new-chapter');
      const topicText = input.value.trim();
      if (!topicText) return;
      const r = await fetch('/api/admin/diary/chapters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicText }),
      });
      const d = await r.json();
      if (!r.ok) return alert(d.error || '등록에 실패했어요.');
      refresh();
    });
  }

  const openGuessingBtn = document.getElementById('diary-open-guessing');
  if (openGuessingBtn) {
    openGuessingBtn.addEventListener('click', async () => {
      if (!confirm('추측 단계를 열까요? 회원들이 서로를 추측할 수 있게 돼요.')) return;
      await fetch('/api/admin/diary/guessing/open', { method: 'POST' });
      refresh();
    });
  }

  const finishBtn = document.getElementById('diary-finish-btn');
  if (finishBtn) {
    finishBtn.addEventListener('click', async () => {
      if (!confirm('완전히 종료할까요? 이후 모든 작성이 중지되고 읽기만 가능해져요. 되돌릴 수 없어요.')) return;
      await fetch('/api/admin/diary/finish', { method: 'POST' });
      refresh();
    });
  }
}

/* ===== 관리자 메뉴 (통합 관리 패널) ===== */

const ADMIN_TABS = [
  { key: 'members', label: '회원' },
  { key: 'menus', label: '메뉴 설정' },
  { key: 'feed', label: 'IE 피드' },
  { key: 'shop', label: '알씨 상점' },
  { key: 'msn', label: 'msn' },
  { key: 'taste', label: '취향표' },
  { key: 'diary', label: '교환일기' },
  { key: 'memo', label: '메모장' },
  { key: 'soribada', label: '소리바다' },
];
let adminTab = 'members';

function adminNavHtml() {
  return `
    <div class="msn-nav" style="flex-wrap:wrap;">
      ${ADMIN_TABS.map((t) => `<button type="button" class="msn-nav-btn admin-nav-btn ${adminTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>`;
}

function bindAdminNav() {
  document.querySelectorAll('.admin-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      adminTab = btn.dataset.tab;
      renderAdminView();
    });
  });
}

async function renderAdminView() {
  winTitleText.textContent = '관리자 메뉴';
  if (adminTab === 'members') return renderAdminMembersTab();
  if (adminTab === 'menus') return renderAdminMenusTab();
  if (adminTab === 'feed') return renderAdminFeedTab();
  if (adminTab === 'shop') return renderAdminShopTab();
  if (adminTab === 'msn') return renderAdminMsnTab();
  if (adminTab === 'taste') return renderAdminTasteTab();
  if (adminTab === 'diary') return renderAdminDiaryTab();
  if (adminTab === 'memo') return renderAdminMemoTab();
  if (adminTab === 'soribada') return renderAdminSoribadaTab();
}

// ── 회원 ─────────────────────────────────────────

async function renderAdminMembersTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const [pendingRes, usersRes] = await Promise.all([fetch('/api/admin/pending'), fetch('/api/admin/users')]);
    const { pending } = await pendingRes.json();
    const { users } = await usersRes.json();

    const pendingHtml = pending.length
      ? pending
          .map(
            (u) => `
            <div class="member-row">
              <div class="member-info"><span class="member-nick">${escapeHtml(u.nickname)}</span></div>
              <div class="member-note">${escapeHtml(u.badge || '')} · ${formatFeedTime(u.created_at)}</div>
              <button type="button" class="view-btn admin-approve-btn" data-id="${u.id}">승인</button>
              <button type="button" class="ghost-btn-shop admin-reject-btn" data-id="${u.id}">거절</button>
            </div>`
          )
          .join('')
      : '<p class="view-muted">대기 중인 가입 신청이 없어요.</p>';

    const usersHtml = users
      .map(
        (u) => `
        <div class="member-row">
          <div class="member-info">
            <span class="member-nick">${escapeHtml(u.nickname)} ${u.is_admin ? '👑' : ''}</span>
            <span class="pref-badge pref-top">${u.status === 'approved' ? '승인됨' : u.status === 'rejected' ? '거절됨' : '대기중'}</span>
          </div>
          <div class="member-note">💰 ${u.points}P · 가입 ${formatFeedTime(u.created_at)}</div>
          <div class="admin-point-form">
            <input type="number" class="feed-num-input admin-point-amount" placeholder="±포인트" data-id="${u.id}" style="width:70px;" />
            <input type="text" class="feed-num-input admin-point-reason" placeholder="사유" data-id="${u.id}" style="width:80px;" />
            <button type="button" class="poke-btn admin-point-apply" data-id="${u.id}">적용</button>
          </div>
        </div>`
      )
      .join('');

    winBody.innerHTML =
      adminNavHtml() +
      `
      <div class="shop-section-title">가입 승인 대기 (${pending.length}명)</div>
      <div class="member-list">${pendingHtml}</div>
      <div class="shop-section-title" style="margin-top:18px;">전체 회원 (${users.length}명) · 포인트 지급/차감</div>
      <div class="member-list">${usersHtml}</div>
    `;
    bindAdminNav();

    document.querySelectorAll('.admin-approve-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/approve/${btn.dataset.id}`, { method: 'POST' });
        renderAdminMembersTab();
      });
    });
    document.querySelectorAll('.admin-reject-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 가입 신청을 거절할까요?')) return;
        await fetch(`/api/admin/reject/${btn.dataset.id}`, { method: 'POST' });
        renderAdminMembersTab();
      });
    });
    document.querySelectorAll('.admin-point-apply').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const amount = parseInt(document.querySelector(`.admin-point-amount[data-id="${id}"]`).value, 10);
        const reason = document.querySelector(`.admin-point-reason[data-id="${id}"]`).value.trim() || '관리자 지급';
        if (!amount) return;
        const r = await fetch('/api/admin/points/adjust', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: Number(id), amount, reason }),
        });
        const d = await r.json();
        if (!r.ok) return alert(d.error || '적용에 실패했어요.');
        renderAdminMembersTab();
      });
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 메뉴 설정 ─────────────────────────────────────────

const ADMIN_MENU_LABELS = {
  memo: '📝 메모장',
  shop: '💿 알씨 (상점)',
  soribada: '🎵 소리바다',
  feed: '🌐 IE (피드)',
  msn: '💬 msn (블라인드)',
  taste: 'ℹ️ 취향표',
  diary: '💌 교환일기',
};

async function renderAdminMenusTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const [menuRes, adsRes] = await Promise.all([fetch('/api/admin/menus'), fetch('/api/admin/ads')]);
    const { menus } = await menuRes.json();
    const { banners } = await adsRes.json();

    const listHtml = Object.entries(menus)
      .map(
        ([key, enabled]) => `
        <div class="member-row">
          <div class="member-info"><span class="member-nick">${ADMIN_MENU_LABELS[key] || key}</span></div>
          <button type="button" class="poke-btn admin-menu-toggle" data-key="${key}" data-enabled="${enabled ? '0' : '1'}">${enabled ? '켜짐 (끄기)' : '꺼짐 (켜기)'}</button>
        </div>`
      )
      .join('');

    const adSlotHtml = (slot, label) => `
      <div class="feed-admin-compose" style="margin-top:10px;">
        <div class="feed-admin-compose-title">${label}</div>
        <input type="text" class="xp-input ad-url-input" data-slot="${slot}" placeholder="이미지 주소(URL)" value="${escapeHtml(banners[slot]?.imageUrl || '')}" />
        <input type="text" class="xp-input ad-link-input" data-slot="${slot}" placeholder="클릭 시 이동할 링크 (선택)" value="${escapeHtml(banners[slot]?.linkUrl || '')}" style="margin-top:6px;" />
        <button type="button" class="view-btn ad-save-btn" data-slot="${slot}" style="margin-top:8px;">저장</button>
        <span class="ad-save-msg" data-slot="${slot}" style="margin-left:8px; font-size:11px; color:#1F8A3C;"></span>
      </div>`;

    winBody.innerHTML =
      adminNavHtml() +
      `<div class="shop-section-title">메뉴 노출 설정</div><div class="member-list">${listHtml}</div>
       <div class="shop-section-title" style="margin-top:20px;">광고 배너 설정 (내 컴퓨터 상단)</div>
       <p class="view-muted">이미지 주소를 비워두면 해당 자리는 숨겨져요.</p>
       ${adSlotHtml('large', '큰 배너 (가로 전체)')}
       ${adSlotHtml('small1', '작은 배너 1')}
       ${adSlotHtml('small2', '작은 배너 2')}
      `;
    bindAdminNav();

    document.querySelectorAll('.admin-menu-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/menus/${btn.dataset.key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: btn.dataset.enabled === '1' }),
        });
        renderAdminMenusTab();
      });
    });

    document.querySelectorAll('.ad-save-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const slot = btn.dataset.slot;
        const imageUrl = document.querySelector(`.ad-url-input[data-slot="${slot}"]`).value.trim();
        const linkUrl = document.querySelector(`.ad-link-input[data-slot="${slot}"]`).value.trim();
        const msgEl = document.querySelector(`.ad-save-msg[data-slot="${slot}"]`);
        const r = await fetch(`/api/admin/ads/${slot}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl, linkUrl }),
        });
        const d = await r.json();
        msgEl.textContent = r.ok ? '저장했어요!' : d.error || '실패';
        setTimeout(() => { msgEl.textContent = ''; }, 2500);
      });
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── IE 피드 ─────────────────────────────────────────

async function renderAdminFeedTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const res = await fetch('/api/admin/feeds');
    const { feeds } = await res.json();

    const listHtml = feeds.length
      ? feeds
          .map(
            (f) => `
            <div class="feed-card">
              <div class="feed-card-head">
                <span class="feed-type-badge ${FEED_TYPE_CLASS[f.type]}">${FEED_TYPE_LABEL[f.type]}</span>
                <span class="feed-card-time">${formatFeedTime(f.publish_at)}</span>
              </div>
              <div class="feed-card-content">${escapeHtml(f.content)}</div>
              <div class="msn-meta">댓글 ${f.comment_count}개 · 보상 ${f.point_reward}P${f.type === 'secret' ? ` · 열람가 ${f.unlock_price}P` : ''}</div>
            </div>`
          )
          .join('')
      : '<p class="view-muted">등록된 피드가 없어요.</p>';

    winBody.innerHTML =
      adminNavHtml() +
      `
      <div class="feed-admin-compose">
        <div class="feed-admin-compose-title">📝 새 피드 작성</div>
        <select id="afeed-type" class="soribada-select">
          <option value="normal">일반 피드</option>
          <option value="participatory">참여형 피드 (댓글 달아야 남의 댓글 보임)</option>
          <option value="secret">비밀 피드 (포인트로 댓글 열람)</option>
        </select>
        <textarea id="afeed-content" class="memo-input feed-new-textarea" placeholder="피드 내용을 입력하세요"></textarea>
        <div class="feed-admin-compose-row">
          <label>댓글 보상 <input type="number" id="afeed-reward" min="0" value="0" class="feed-num-input" /> P</label>
          <label>열람 가격 <input type="number" id="afeed-unlock" min="0" value="0" class="feed-num-input" /> P (비밀 피드용)</label>
        </div>
        <div class="feed-admin-compose-row">
          <label>예약 발행 <input type="datetime-local" id="afeed-publish" class="feed-num-input" style="width:auto;" /> (비워두면 즉시 발행)</label>
        </div>
        <p id="afeed-error" class="xp-error hidden"></p>
        <button type="button" id="afeed-submit" class="view-btn">피드 등록</button>
      </div>
      <div class="shop-section-title" style="margin-top:16px;">전체 피드 (${feeds.length}개, 예약 포함)</div>
      <div class="feed-list">${listHtml}</div>
    `;
    bindAdminNav();

    document.getElementById('afeed-submit').addEventListener('click', async () => {
      const errorEl = document.getElementById('afeed-error');
      errorEl.classList.add('hidden');
      const type = document.getElementById('afeed-type').value;
      const content = document.getElementById('afeed-content').value.trim();
      const pointReward = parseInt(document.getElementById('afeed-reward').value, 10) || 0;
      const unlockPrice = parseInt(document.getElementById('afeed-unlock').value, 10) || 0;
      const publishAt = document.getElementById('afeed-publish').value || null;
      if (!content) {
        errorEl.textContent = '피드 내용을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      const r = await fetch('/api/admin/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, content, pointReward, unlockPrice, publishAt }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '등록에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      renderAdminFeedTab();
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 알씨 상점 ─────────────────────────────────────────

async function renderAdminShopTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const [itemsRes, drawsRes] = await Promise.all([fetch('/api/admin/shop/items'), fetch('/api/admin/gacha/draws')]);
    const { items } = await itemsRes.json();
    const { draws } = await drawsRes.json();
    const prizesHtmlHolder = await buildGachaAdminHtml();

    const itemsHtml = items.length
      ? items
          .map(
            (it) => `
            <div class="member-row">
              <div class="member-info">
                <span class="member-nick">${it.icon || '🎁'} ${escapeHtml(it.name)}</span>
                <span class="pref-badge pref-top">${SHOP_TYPE_LABEL[it.type] || it.type}</span>
              </div>
              <div class="member-note">💰 ${it.price}P ${it.active ? '' : '(비활성)'}</div>
              <button type="button" class="poke-btn admin-item-toggle" data-id="${it.id}" data-enabled="${it.active ? '0' : '1'}">${it.active ? '끄기' : '켜기'}</button>
            </div>`
          )
          .join('')
      : '<p class="view-muted">등록된 아이템이 없어요.</p>';

    const drawsHtml = draws.length
      ? draws
          .slice(0, 30)
          .map(
            (d) => `<div class="member-row"><div class="member-info"><span class="member-nick">${escapeHtml(d.nickname)}</span></div><div class="member-note">${escapeHtml(d.prize_name)}${d.point_reward > 0 ? ` (+${d.point_reward}P)` : ''} · ${formatFeedTime(d.created_at)}</div></div>`
          )
          .join('')
      : '<p class="view-muted">뽑기 기록이 없어요.</p>';

    winBody.innerHTML =
      adminNavHtml() +
      `
      <div class="feed-admin-compose">
        <div class="feed-admin-compose-title">🎁 새 아이템 등록</div>
        <select id="ashop-type" class="soribada-select">
          <option value="gift">선물</option>
          <option value="anon_note">익명 쪽지</option>
          <option value="mp3">mp3</option>
          <option value="magnifier">돋보기</option>
          <option value="pass">열람권</option>
          <option value="coin">동전</option>
          <option value="nameplate">이름표</option>
          <option value="gacha">뽑기</option>
        </select>
        <input type="text" id="ashop-name" class="xp-input" placeholder="아이템 이름" style="margin-top:6px;" />
        <div class="feed-admin-compose-row">
          <label>가격 <input type="number" id="ashop-price" min="0" value="0" class="feed-num-input" /> P</label>
          <label>아이콘(이모지) <input type="text" id="ashop-icon" class="feed-num-input" placeholder="🎁" style="width:50px;" /></label>
        </div>
        <p id="ashop-error" class="xp-error hidden"></p>
        <button type="button" id="ashop-submit" class="view-btn">아이템 등록</button>
      </div>
      <div class="shop-section-title" style="margin-top:16px;">아이템 목록</div>
      <div class="member-list">${itemsHtml}</div>

      <div class="shop-section-title" style="margin-top:20px;">상점 구매 내역 필터 검색</div>
      <div class="soribada-compose">
        <div class="feed-admin-compose-row">
          <input type="text" id="apurch-sender" class="xp-input" placeholder="보낸 사람 닉네임" style="flex:1;" />
          <input type="text" id="apurch-recipient" class="xp-input" placeholder="받는 사람 닉네임" style="flex:1;" />
        </div>
        <select id="apurch-type" class="soribada-select" style="margin-top:6px;">
          <option value="">전체 종류</option>
          <option value="gift">선물</option>
          <option value="anon_note">익명 쪽지</option>
          <option value="mp3">mp3</option>
          <option value="magnifier">돋보기</option>
          <option value="pass">열람권</option>
          <option value="coin">동전</option>
          <option value="nameplate">이름표</option>
          <option value="gacha">뽑기</option>
        </select>
        <button type="button" id="apurch-search" class="view-btn" style="margin-top:8px;">검색</button>
        <div id="apurch-result" style="margin-top:10px;"></div>
      </div>

      ${prizesHtmlHolder}
      <div class="shop-section-title" style="margin-top:16px;">뽑기 내역 (최근 30건)</div>
      <div class="member-list">${drawsHtml}</div>
    `;
    bindAdminNav();
    bindGachaAdmin(renderAdminShopTab);

    document.getElementById('ashop-submit').addEventListener('click', async () => {
      const errorEl = document.getElementById('ashop-error');
      errorEl.classList.add('hidden');
      const type = document.getElementById('ashop-type').value;
      const name = document.getElementById('ashop-name').value.trim();
      const price = parseInt(document.getElementById('ashop-price').value, 10) || 0;
      const icon = document.getElementById('ashop-icon').value.trim();
      if (!name) {
        errorEl.textContent = '아이템 이름을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      const r = await fetch('/api/admin/shop/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name, price, icon }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '등록에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      renderAdminShopTab();
    });

    document.querySelectorAll('.admin-item-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/shop/items/${btn.dataset.id}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: btn.dataset.enabled === '1' }),
        });
        renderAdminShopTab();
      });
    });

    document.getElementById('apurch-search').addEventListener('click', async () => {
      const params = new URLSearchParams();
      const sender = document.getElementById('apurch-sender').value.trim();
      const recipient = document.getElementById('apurch-recipient').value.trim();
      const type = document.getElementById('apurch-type').value;
      if (sender) params.set('senderNickname', sender);
      if (recipient) params.set('recipientNickname', recipient);
      if (type) params.set('itemType', type);
      const resultEl = document.getElementById('apurch-result');
      resultEl.innerHTML = '<p class="view-loading">검색 중...</p>';
      const r = await fetch(`/api/admin/shop/purchases?${params.toString()}`);
      const d = await r.json();
      resultEl.innerHTML = d.purchases.length
        ? d.purchases
            .map(
              (p) => `
              <div class="member-row">
                <div class="member-info"><span class="member-nick">${escapeHtml(p.sender_nickname)} → ${escapeHtml(p.recipient_nickname)}</span></div>
                <div class="member-note">${SHOP_TYPE_LABEL[p.item_type] || p.item_type}: ${escapeHtml(p.item_name)}${p.message ? ` "${escapeHtml(p.message)}"` : ''} · ${formatFeedTime(p.created_at)}</div>
              </div>`
            )
            .join('')
        : '<p class="view-muted">결과가 없어요.</p>';
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── msn ─────────────────────────────────────────

async function renderAdminMsnTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const res = await fetch('/api/admin/msn/topics');
    const { topics } = await res.json();

    const topicsHtml = topics.length
      ? topics
          .map(
            (t) => `
            <div class="feed-card">
              <div class="feed-card-head">
                <span class="msn-share-badge ${t.sharing_enabled ? 'on' : 'off'}">${t.sharing_enabled ? '공유 중' : '공유 대기'}</span>
                <span class="feed-card-time">${formatFeedTime(t.created_at)}</span>
              </div>
              <div class="feed-card-content">${escapeHtml(t.content)}</div>
              <div class="msn-meta">
                <button type="button" class="ghost-btn-shop amsn-toggle" data-id="${t.id}" data-enabled="${t.sharing_enabled ? '0' : '1'}">${t.sharing_enabled ? '공유 끄기' : '공유 켜기'}</button>
                <span class="msn-answers-toggle" data-id="${t.id}">답변/대화 보기 (실명)</span>
              </div>
              <div class="msn-answers-wrap" id="amsn-detail-${t.id}"></div>
            </div>`
          )
          .join('')
      : '<p class="view-muted">등록된 주제가 없어요.</p>';

    winBody.innerHTML =
      adminNavHtml() +
      `
      <div class="feed-admin-compose">
        <div class="feed-admin-compose-title">📝 새 주제 등록</div>
        <textarea id="amsn-content" class="memo-input feed-new-textarea" placeholder="주제 내용을 입력하세요"></textarea>
        <div class="feed-admin-compose-row">
          <label>수정 마감 <input type="datetime-local" id="amsn-deadline" class="feed-num-input" style="width:auto;" /> (선택)</label>
        </div>
        <p id="amsn-error" class="xp-error hidden"></p>
        <button type="button" id="amsn-submit" class="view-btn">주제 등록</button>
      </div>
      <div class="shop-section-title" style="margin-top:16px;">전체 주제</div>
      <div class="feed-list">${topicsHtml}</div>
    `;
    bindAdminNav();

    document.getElementById('amsn-submit').addEventListener('click', async () => {
      const errorEl = document.getElementById('amsn-error');
      errorEl.classList.add('hidden');
      const content = document.getElementById('amsn-content').value.trim();
      const editDeadline = document.getElementById('amsn-deadline').value || null;
      if (!content) {
        errorEl.textContent = '주제 내용을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      const r = await fetch('/api/admin/msn/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, editDeadline }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '등록에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      renderAdminMsnTab();
    });

    document.querySelectorAll('.amsn-toggle').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await fetch(`/api/admin/msn/topics/${btn.dataset.id}/sharing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: btn.dataset.enabled === '1' }),
        });
        renderAdminMsnTab();
      });
    });

    document.querySelectorAll('.msn-answers-toggle').forEach((el) => {
      el.addEventListener('click', async () => {
        const wrap = document.getElementById(`amsn-detail-${el.dataset.id}`);
        if (wrap.dataset.loaded === 'true') {
          wrap.innerHTML = '';
          wrap.dataset.loaded = 'false';
          return;
        }
        wrap.innerHTML = '<p class="view-loading">불러오는 중...</p>';
        const [ansRes, thrRes] = await Promise.all([
          fetch(`/api/admin/msn/topics/${el.dataset.id}/answers`),
          fetch(`/api/admin/msn/topics/${el.dataset.id}/threads`),
        ]);
        const { answers } = await ansRes.json();
        const { threads } = await thrRes.json();
        const ansHtml = answers
          .map((a) => `<div class="msn-answer-row"><span class="msn-answer-tag">${escapeHtml(a.nickname)}</span><div class="msn-answer-text">${escapeHtml(a.content)}</div></div>`)
          .join('') || '<p class="view-muted">답변 없음</p>';
        const thrHtml = threads
          .map(
            (t) => `
            <div class="msn-answer-row">
              <span class="msn-answer-tag">${escapeHtml(t.owner_nickname)} ↔ ${escapeHtml(t.initiator_nickname)}</span>
              ${t.messages.map((m) => `<div class="msn-answer-text">${escapeHtml(m.sender_nickname)}: ${escapeHtml(m.content)}</div>`).join('')}
            </div>`
          )
          .join('') || '<p class="view-muted">대화 없음</p>';
        wrap.innerHTML = `<div class="msn-answer-tag">답변</div>${ansHtml}<div class="msn-answer-tag" style="margin-top:6px;">대화</div>${thrHtml}`;
        wrap.dataset.loaded = 'true';
      });
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 취향표 ─────────────────────────────────────────

async function renderAdminTasteTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const res = await fetch('/api/admin/taste/questions');
    const { questions } = await res.json();

    const qHtml = questions.length
      ? questions
          .map((q) => `<div class="member-row"><div class="member-info"><span class="member-nick">${escapeHtml(q.question_text)}</span><span class="pref-badge pref-top">${TASTE_TYPE_LABEL[q.question_type] || q.question_type}</span></div></div>`)
          .join('')
      : '<p class="view-muted">등록된 질문이 없어요.</p>';

    winBody.innerHTML =
      adminNavHtml() +
      `
      <div class="feed-admin-compose">
        <div class="feed-admin-compose-title">📝 새 질문 등록</div>
        <input type="text" id="ataste-question" class="xp-input" placeholder="질문 내용을 입력하세요" />
        <select id="ataste-type" class="soribada-select" style="margin-top:6px;">
          <option value="text">서술형</option>
          <option value="radio">라디오 (하나만 선택)</option>
          <option value="checkbox">체크박스 (여러 개 선택)</option>
        </select>
        <input type="text" id="ataste-options" class="xp-input hidden" placeholder="선택지를 쉼표(,)로 구분해서 입력" style="margin-top:6px;" />
        <p id="ataste-error" class="xp-error hidden"></p>
        <button type="button" id="ataste-submit" class="view-btn" style="margin-top:8px;">질문 등록</button>
      </div>
      <div class="shop-section-title" style="margin-top:16px;">전체 질문</div>
      <div class="member-list">${qHtml}</div>

      <div class="shop-section-title" style="margin-top:20px;">특정 회원 취향표 조회 (실명)</div>
      <div class="soribada-compose">
        <input type="text" id="ataste-lookup-nick" class="xp-input" placeholder="닉네임 입력" />
        <button type="button" id="ataste-lookup-btn" class="view-btn" style="margin-top:8px;">조회</button>
        <div id="ataste-lookup-result" style="margin-top:10px;"></div>
      </div>
    `;
    bindAdminNav();

    const typeSelect = document.getElementById('ataste-type');
    const optionsInput = document.getElementById('ataste-options');
    typeSelect.addEventListener('change', () => {
      optionsInput.classList.toggle('hidden', typeSelect.value === 'text');
    });

    document.getElementById('ataste-submit').addEventListener('click', async () => {
      const errorEl = document.getElementById('ataste-error');
      errorEl.classList.add('hidden');
      const questionText = document.getElementById('ataste-question').value.trim();
      const questionType = typeSelect.value;
      const options = optionsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!questionText) {
        errorEl.textContent = '질문 내용을 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (questionType !== 'text' && options.length < 2) {
        errorEl.textContent = '선택지를 2개 이상 입력해 주세요.';
        errorEl.classList.remove('hidden');
        return;
      }
      const r = await fetch('/api/admin/taste/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionText, questionType, options }),
      });
      const d = await r.json();
      if (!r.ok) {
        errorEl.textContent = d.error || '등록에 실패했어요.';
        errorEl.classList.remove('hidden');
        return;
      }
      renderAdminTasteTab();
    });

    document.getElementById('ataste-lookup-btn').addEventListener('click', async () => {
      const nickname = document.getElementById('ataste-lookup-nick').value.trim();
      const resultEl = document.getElementById('ataste-lookup-result');
      if (!nickname) return;
      resultEl.innerHTML = '<p class="view-loading">불러오는 중...</p>';
      const r = await fetch(`/api/admin/taste/${encodeURIComponent(nickname)}`);
      if (!r.ok) {
        resultEl.innerHTML = '<p class="view-msg">회원을 찾을 수 없어요.</p>';
        return;
      }
      const { answers } = await r.json();
      resultEl.innerHTML = answers
        .map((a) => `<div class="taste-question-row"><div class="taste-question-text">${escapeHtml(a.questionText)}</div><div class="feed-comment-content">${renderAnswerDisplayHtml(a)}</div></div>`)
        .join('') || '<p class="view-muted">작성된 답변이 없어요.</p>';
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 교환일기 ─────────────────────────────────────────

async function renderAdminDiaryTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const adminBlock = await buildDiaryAdminHtml(renderAdminDiaryTab);
    winBody.innerHTML = adminNavHtml() + adminBlock;
    bindAdminNav();
    bindDiaryAdmin(renderAdminDiaryTab);

    document.querySelectorAll('.diary-pair-view-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const wrap = document.getElementById(`adiary-detail-${btn.dataset.pairId}`);
        if (wrap.dataset.loaded === 'true') {
          wrap.innerHTML = '';
          wrap.dataset.loaded = 'false';
          return;
        }
        wrap.innerHTML = '<p class="view-loading">불러오는 중...</p>';
        const r = await fetch(`/api/admin/diary/pairs/${btn.dataset.pairId}/entries`);
        const d = await r.json();
        const chaptersHtml = d.chapters
          .map(
            (c) => `
            <div class="msn-answer-row">
              <span class="msn-answer-tag">${c.chapterNumber}장. ${escapeHtml(c.topicText)}</span>
              <div class="msn-answer-text">${escapeHtml(d.aNickname)}: ${c.aEntry ? escapeHtml(c.aEntry.content) : '(미작성)'}</div>
              <div class="msn-answer-text">${escapeHtml(d.bNickname)}: ${c.bEntry ? escapeHtml(c.bEntry.content) : '(미작성)'}</div>
            </div>`
          )
          .join('');
        const finalHtml = d.finalEntries
          .map((f) => `<div class="msn-answer-text">${escapeHtml(f.nickname)}: ${escapeHtml(f.content)}</div>`)
          .join('') || '<p class="view-muted">마지막 장 대화 없음</p>';
        wrap.innerHTML = `${chaptersHtml}<div class="msn-answer-tag" style="margin-top:6px;">✨ 마지막 장</div>${finalHtml}`;
        wrap.dataset.loaded = 'true';
      });
    });
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 메모장 ─────────────────────────────────────────

async function renderAdminMemoTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const res = await fetch('/api/admin/memo-notes');
    const { notes } = await res.json();
    const listHtml = notes.length
      ? notes
          .map(
            (n) => `
            <div class="member-row">
              <div class="member-info"><span class="member-nick">${escapeHtml(n.nickname)} (익명${n.anon_number})</span></div>
              <div class="member-note">${escapeHtml(n.content)} · ${formatFeedTime(n.created_at)}</div>
            </div>`
          )
          .join('')
      : '<p class="view-muted">작성된 메모가 없어요.</p>';
    winBody.innerHTML = adminNavHtml() + `<div class="shop-section-title">메모장 전체 (실명, 최근 200개)</div><div class="member-list">${listHtml}</div>`;
    bindAdminNav();
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

// ── 소리바다 ─────────────────────────────────────────

async function renderAdminSoribadaTab() {
  winBody.innerHTML = adminNavHtml() + '<p class="view-loading">불러오는 중...</p>';
  bindAdminNav();
  try {
    const res = await fetch('/api/admin/soribada-tracks');
    const { tracks } = await res.json();
    const listHtml = tracks.length
      ? tracks
          .map(
            (t) => `
            <div class="member-row">
              <div class="member-info"><span class="member-nick">${escapeHtml(t.sender_nickname || '?')} → ${escapeHtml(t.recipient_nickname)}</span></div>
              <div class="member-note">${escapeHtml(t.title)}.mp3 · ${formatFeedTime(t.created_at)}</div>
            </div>`
          )
          .join('')
      : '<p class="view-muted">등록된 트랙이 없어요.</p>';
    winBody.innerHTML = adminNavHtml() + `<div class="shop-section-title">소리바다 전체 (실명)</div><div class="member-list">${listHtml}</div>`;
    bindAdminNav();
  } catch (err) {
    winBody.innerHTML = adminNavHtml() + '<p class="view-msg">불러오지 못했어요.</p>';
    bindAdminNav();
  }
}

function switchView(view, label) {
  if (view === 'my-computer') renderMyComputerView();
  else if (view === 'my-documents') renderMyDocumentsView();
  else if (view === 'memo') renderMemoView();
  else if (view === 'soribada') renderSoribadaView();
  else if (view === 'feed') renderFeedView();
  else if (view === 'shop') renderShopView();
  else if (view === 'msn') { msnSubTab = 'topics'; renderMsnView(); }
  else if (view === 'taste') renderTasteView();
  else if (view === 'diary') renderDiaryView();
  else if (view === 'admin') { adminTab = 'members'; renderAdminView(); }
  else if (view === 'placeholder') renderPlaceholderView(label);
  else renderHomeView();
}

document.querySelectorAll('.window-side-menu .desktop-icon').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.window-side-menu .desktop-icon').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    switchView(item.dataset.view, item.dataset.label);
  });
});

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      showApp(data.nickname, data.isAdmin, data.points);
    } else {
      showXp();
    }
  } catch (err) {
    showXp();
  }
}

loginPanel.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.classList.add('hidden');
  const nickname = document.getElementById('login-nickname').value.trim();
  const password = document.getElementById('login-password').value;

  if (!nickname || !password) {
    loginError.textContent = '닉네임과 비밀번호를 입력해 주세요.';
    loginError.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || '로그인에 실패했어요.';
      loginError.classList.remove('hidden');
      return;
    }
    showApp(data.nickname, data.isAdmin, data.points);
  } catch (err) {
    loginError.textContent = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
    loginError.classList.remove('hidden');
  }
});

signupPanel.addEventListener('submit', async (e) => {
  e.preventDefault();
  signupError.classList.add('hidden');
  signupNotice.classList.add('hidden');

  const nickname = document.getElementById('signup-nickname').value.trim();
  const password = document.getElementById('signup-password').value;
  const passwordConfirm = document.getElementById('signup-confirm').value;
  const preferenceInput = document.querySelector('input[name="pref"]:checked');
  const preference = preferenceInput ? preferenceInput.value : null;
  const curriculum = Array.from(document.querySelectorAll('input[name="curriculum"]:checked')).map((el) => el.value);

  if (!nickname || !preference || !password) {
    signupError.textContent = '모든 항목을 입력해 주세요.';
    signupError.classList.remove('hidden');
    return;
  }
  if (curriculum.length === 0) {
    signupError.textContent = '커리큘럼(게이/레즈비언)을 하나 이상 선택해 주세요.';
    signupError.classList.remove('hidden');
    return;
  }
  if (password !== passwordConfirm) {
    signupError.textContent = '비밀번호가 서로 달라요.';
    signupError.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password, preference, curriculum }),
    });
    const data = await res.json();
    if (!res.ok) {
      signupError.textContent = data.error || '가입에 실패했어요.';
      signupError.classList.remove('hidden');
      return;
    }
    signupNotice.textContent = data.message || '가입 신청이 접수됐어요. 관리자 승인 후 로그인할 수 있어요.';
    signupNotice.classList.remove('hidden');
    signupPanel.reset();
  } catch (err) {
    signupError.textContent = '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.';
    signupError.classList.remove('hidden');
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  showXp();
});

checkSession();
