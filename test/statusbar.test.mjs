// Headless wiring test for plugins/dsh-account-statusbar/client.js.
//
// It does not render: it records what the browser module registers with the
// slot service and checks how one mocked account Remote outcome reaches the
// store and the component's text. Run: node test/statusbar.test.mjs（在插件目录下执行）
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const checks = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, ok, actual, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`);
}

/** Minimal React surface the plugin uses. Hooks are inert; snapshots are read eagerly. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

const requireStub = (id) => {
  if (id === 'react') return React;
  throw new Error(`unexpected require: ${id}`);
};

/** Boot one fresh copy of the browser half against a mocked context. */
function load(fixture) {
  const registrations = [];
  let loaded;
  const styleTags = [];
  const documentStub = {
    visibilityState: 'visible',
    documentElement: { lang: 'zh-CN' },
    querySelector: () => null,
    head: { appendChild: (tag) => styleTags.push(tag) },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const windowStub = {
    __ModuleLoader__: {
      load(descriptor) {
        loaded = descriptor;
      },
    },
  };
  const fn = new Function(
    'window',
    'document',
    'globalThis',
    'setTimeout',
    'setInterval',
    'clearInterval',
    'clearTimeout',
    source,
  );
  fn(windowStub, documentStub, { __DSH_BOOT__: { release: { version: '0.2.1-rc.5' } } }, setTimeout, setInterval, clearInterval, clearTimeout);

  const ctx = {
    effects: [],
    effect(factory) {
      const dispose = factory();
      this.effects.push(dispose);
      return dispose;
    },
    locale: {
      registered: null,
      register(namespace, dictionaries) {
        this.registered = { namespace, dictionaries };
        return () => {};
      },
      getSnapshot: () => ({ active: 'zh' }),
      bind: () => (key) => key,
    },
    remote: {
      account: {
        getBalance: async (metadata) => {
          ctx.lastMetadata = metadata;
          return fixture;
        },
      },
    },
    slots: {
      inject(owner, callback) {
        const dispose = callback();
        registrations.push({ owner, dispose });
        return dispose;
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };

  ctx.plugin = loaded.factory(requireStub);
  ctx.plugin.apply(ctx);
  return { ctx, registrations, windowStub, documentStub };
}

const copy = {
  label: 'DeepSeek 余额',
  loading: '读取中',
  signedOut: '未登录',
  failed: '余额不可用',
  empty: '暂无余额',
  refresh: '刷新 DeepSeek 余额',
  updated: '更新于',
  bonus: '赠送余额',
};

function renderText(registration, extra = {}) {
  const props = { t: (key) => copy[key] ?? key, ...registration.options.inject(), ...extra };
  const tree = registration.component(props);
  const text = [];
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return;
    if (typeof node === 'string') {
      text.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk(node.children);
  };
  walk(tree);
  return { tree, text: text.join('|'), titles: collectTitles(tree) };
}

function collectTitles(node, found = []) {
  if (node === null || node === undefined || typeof node === 'string') return found;
  if (Array.isArray(node)) {
    node.forEach((child) => collectTitles(child, found));
    return found;
  }
  if (typeof node.props?.title === 'string') found.push(node.props.title);
  collectTitles(node.children, found);
  return found;
}

const tick = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

// --- signed-in account with recharge and bonus wallets -----------------------
{
  const { ctx, registrations } = load({
    ok: true,
    value: {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '1234.5' }],
      bonusWallets: [{ currency: 'CNY', balance: '2' }],
    },
  });
  check('exports an inject list', ctx.plugin.inject, ['slots', 'locale', 'remote', 'remote.account']);
  check('registers one shell.bottom entry', registrations.filter((entry) => entry.options).map((entry) => entry.options.name), ['shell.bottom']);
  check('registration id', registrations.find((entry) => entry.options).options.id, 'account-balance');
  check('registration locale', registrations.find((entry) => entry.options).options.locale, 'statusbar');
  check('owner key is shell.bottom', registrations.find((entry) => entry.owner)?.owner ?? registrations[0].owner, 'shell.bottom');
  await tick();
  check('sends host release version', ctx.lastMetadata.version, '0.2.1-rc.5');
  check('sends locale', ctx.lastMetadata.locale, 'zh');
  const { text, tree } = renderText(registrations.find((entry) => entry.options));
  check('shows grouped amount and bonus', text.includes('¥1,234.50'), true);
  check('shows bonus chip', text.includes('+¥2.00'), true);
  check('bar flagged for height styling', tree.props['data-status-bar'], true);
}

// --- signed out --------------------------------------------------------------
{
  const { ctx, registrations } = load({ ok: true, value: null });
  await tick();
  const { text } = renderText(registrations.find((entry) => entry.options));
  check('signed-out copy', text.includes('未登录'), true);
  check('no amount when signed out', text.includes('¥'), false);
  void ctx;
}

// --- remote failure ----------------------------------------------------------
{
  const { ctx, registrations } = load({ ok: false, error: { code: 'ACCOUNT_SIGN_IN_REQUIRED' } });
  await tick();
  const { text, titles } = renderText(registrations.find((entry) => entry.options));
  check('failure copy', text.includes('余额不可用'), true);
  check('failure code reaches the tooltip', titles.some((title) => title.includes('ACCOUNT_SIGN_IN_REQUIRED')), true);
  void ctx;
}

// --- balance outcome reports failure ----------------------------------------
{
  const { ctx, registrations } = load({ ok: true, value: { status: 'failed' } });
  await tick();
  const { text } = renderText(registrations.find((entry) => entry.options));
  check('balance failed outcome', text.includes('余额不可用'), true);
  void ctx;
}

// --- signed-in but empty wallets --------------------------------------------
{
  const { ctx, registrations } = load({ ok: true, value: { status: 'ready', value: [], bonusWallets: [] } });
  await tick();
  const { text } = renderText(registrations.find((entry) => entry.options));
  check('empty wallet copy', text.includes('暂无余额'), true);
  void ctx;
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
