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
const logoutBtn = document.getElementById('logout-btn');
const adminLink = document.getElementById('admin-link');

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

function showApp(nickname, isAdmin) {
  welcomeNickname.textContent = nickname;
  adminLink.classList.toggle('hidden', !isAdmin);
  xpScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
}

function showXp() {
  xpScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      showApp(data.nickname, data.isAdmin);
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
    showApp(data.nickname, data.isAdmin);
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

  if (!nickname || !preference || !password) {
    signupError.textContent = '모든 항목을 입력해 주세요.';
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
      body: JSON.stringify({ nickname, password, preference }),
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
