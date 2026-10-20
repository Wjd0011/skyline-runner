// All user-visible copy lives here (PRD 8.5): zh-CN is the default, en-US is
// the reserve locale. Nothing in the render or UI logic hardcodes a string.

export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALES = ['zh-CN', 'en-US'];

const DICT = {
  'zh-CN': {
    'doc.title': 'SKYLINE RUNNER — 天际行者',
    'doc.canvas': '游戏画面',

    'a11y.hearts': '生命 {hp}/{max}',
    'a11y.pause': '暂停',

    'hud.score': '分数',
    'hud.distance': '距离',
    'hud.unit': 'm',

    'kicker.title': '程序化霓虹跑酷',
    'title.sub': '天际行者 · 每一栋建筑都由种子生成',
    'title.start': '开始奔跑',
    'controls.move': '移动',
    'controls.jump': '跳跃',
    'controls.pause': '暂停',
    'controls.sound': '声音',

    'meta.seed': '种子',
    'meta.best': '最高',
    'meta.ver': '版本',
    'meta.reseed': '换一个种子',

    'sound.on': '声音 开',
    'sound.off': '声音 关',
    'sound.aria': '音效开关',
    'lang.aria': '切换语言',
    'lang.switchTo': 'EN',
    'lang.name.zh-CN': '中文',
    'lang.name.en-US': 'English',

    'diff.easy': '简单',
    'diff.normal': '中等',
    'diff.hard': '困难',
    'diff.aria': '难度选择',
    'diff.easy.code': '简单',
    'diff.normal.code': '中等',
    'diff.hard.code': '困难',
    'diff.easy.short': 'EASY',
    'diff.normal.short': 'NORMAL',
    'diff.hard.short': 'HARD',

    'pause.kicker': '暂停',
    'pause.title': '游戏暂停',
    'pause.hint': '按',
    'pause.hint2': '继续',
    'pause.resume': '继续',
    'pause.quit': '回到标题',

    'over.kicker': '信号丢失',
    'over.title': '本次结束',
    'over.retry': '再来一次',
    'over.toTitle': '回到标题',

    'touch.left': '左移',
    'touch.right': '右移',
    'touch.jump': '跳跃',

    'toast.controls': 'A / D 移动 · SPACE 跳跃',
    'toast.paused': '已暂停',
    'toast.diff': '{name}难度',
    'toast.lang': '界面语言：{name}',
    'toast.seed': '新种子 {seed}',
    'toast.milestone': '{m} 米',
  },

  'en-US': {
    'doc.title': 'SKYLINE RUNNER — neon rooftop runner',
    'doc.canvas': 'game canvas',

    'a11y.hearts': 'Health {hp}/{max}',
    'a11y.pause': 'Pause',

    'hud.score': 'SCORE',
    'hud.distance': 'DISTANCE',
    'hud.unit': 'm',

    'kicker.title': 'PROCEDURAL SKYLINE PLATFORMER',
    'title.sub': 'Every tower is generated from a seed',
    'title.start': 'Start run',
    'controls.move': 'move',
    'controls.jump': 'jump',
    'controls.pause': 'pause',
    'controls.sound': 'sound',

    'meta.seed': 'SEED',
    'meta.best': 'BEST',
    'meta.ver': 'VER',
    'meta.reseed': 'New seed',

    'sound.on': 'SOUND ON',
    'sound.off': 'SOUND OFF',
    'sound.aria': 'Toggle sound',
    'lang.aria': 'Switch language',
    'lang.switchTo': '中文',
    'lang.name.zh-CN': '中文',
    'lang.name.en-US': 'English',

    'diff.easy': 'Easy',
    'diff.normal': 'Normal',
    'diff.hard': 'Hard',
    'diff.aria': 'Difficulty',
    'diff.easy.code': 'EASY',
    'diff.normal.code': 'NORMAL',
    'diff.hard.code': 'HARD',
    'diff.easy.short': '',
    'diff.normal.short': '',
    'diff.hard.short': '',

    'pause.kicker': 'PAUSED',
    'pause.title': 'Paused',
    'pause.hint': 'Press',
    'pause.hint2': 'to resume',
    'pause.resume': 'Resume',
    'pause.quit': 'Back to title',

    'over.kicker': 'SIGNAL LOST',
    'over.title': 'Run over',
    'over.retry': 'Run again',
    'over.toTitle': 'Title screen',

    'touch.left': 'left',
    'touch.right': 'right',
    'touch.jump': 'jump',

    'toast.controls': 'A / D move · SPACE jump',
    'toast.paused': 'PAUSED',
    'toast.diff': '{name} difficulty',
    'toast.lang': 'Language: {name}',
    'toast.seed': 'New seed {seed}',
    'toast.milestone': '{m} m',
  },
};

let locale = DEFAULT_LOCALE;
const formatters = new Map();

export function getLocale() {
  return locale;
}

export function isLocale(value) {
  return Object.prototype.hasOwnProperty.call(DICT, value);
}

const ALIASES = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
};

/** Accepts "en", "en-GB", "zh"… and returns a supported locale or null. */
export function normalizeLocale(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (isLocale(raw)) return raw;
  const key = raw.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  return ALIASES[key.split('-')[0]] || null;
}

export function setLocale(next) {
  if (!isLocale(next)) return false;
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  return true;
}

export function t(key, vars) {
  const table = DICT[locale] || DICT[DEFAULT_LOCALE];
  const raw = table[key] ?? DICT[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/** Locale-aware integer formatting ("1,234" vs "1234"). */
export function fmtInt(value) {
  const n = Number(value) || 0;
  let f = formatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    formatters.set(locale, f);
  }
  return f.format(n);
}

/** Fill every [data-i18n] / [data-i18n-aria] node, plus <title>. */
export function applyStatic(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  if (root === document) document.title = t('doc.title');
}

export function keys(loc = locale) {
  return Object.keys(DICT[loc]).sort();
}
