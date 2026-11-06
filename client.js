/**
 * Browser half of the account status bar.
 *
 * Registers the first item of the root `shell.bottom` slot: the DeepSeek
 * account balance, read through the shipped `account` Remote namespace (the
 * same Host path the Account settings page uses, so the Platform grant, its
 * refresh and its failure handling stay in one place).
 *
 * The bar frame is a row of items; later items append to `renderItem` and the
 * frame already gives them the shared height, divider and hover treatment.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-account-statusbar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'statusbar';
    /** Balance re-read interval; the item also refreshes on click and on return to the tab. */
    const REFRESH_MS = 60_000;
    /** Age after which returning to the tab re-reads instead of trusting the last value. */
    const STALE_MS = 30_000;
    /** Delay before the first read, so the bar never competes with page startup. */
    const FIRST_READ_MS = 400;
    /** Version sent with an account call when the boot graph carries none. */
    const FALLBACK_HOST_VERSION = '0.2.1-rc.5';

    /** Chinese copy. */
    const zh = {
      label: 'DeepSeek 余额',
      loading: '读取中',
      signedOut: '未登录',
      failed: '余额不可用',
      empty: '暂无余额',
      refresh: '刷新 DeepSeek 余额',
      updated: '更新于',
      bonus: '赠送余额',
    };

    /** English copy. */
    const en = {
      label: 'DeepSeek balance',
      loading: 'Loading',
      signedOut: 'Not signed in',
      failed: 'Balance unavailable',
      empty: 'No balance',
      refresh: 'Refresh the DeepSeek balance',
      updated: 'Updated',
      bonus: 'Bonus credit',
    };

    const CSS = `
.dsh-account-statusbar{display:flex;align-items:center;justify-content:space-between;gap:8px;box-sizing:border-box;width:100%;height:26px;padding:0 8px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;user-select:none;-webkit-user-select:none}
.dsh-account-statusbar__row{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden}
.dsh-account-statusbar__item{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dsh-account-statusbar__item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-account-statusbar__item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-account-statusbar__dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.dsh-account-statusbar__dot[data-tone="ready"]{background:var(--dsw-alias-state-success-primary)}
.dsh-account-statusbar__dot[data-tone="loading"]{background:var(--dsw-alias-state-idle-primary)}
.dsh-account-statusbar__dot[data-tone="failed"]{background:var(--dsw-alias-state-error-primary)}
.dsh-account-statusbar__label{color:var(--dsw-alias-label-secondary)}
.dsh-account-statusbar__value{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
.dsh-account-statusbar__value[data-tone="muted"]{color:var(--dsw-alias-label-tertiary);font-weight:400}
.dsh-account-statusbar__value[data-tone="stale"]{color:var(--dsw-alias-label-secondary);font-weight:500}
.dsh-account-statusbar__value[data-tone="failed"]{color:var(--dsw-alias-state-error-primary);font-weight:400}
.dsh-account-statusbar__bonus{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums}
.dsh-account-statusbar__spinner{flex:none;width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-brand-primary);animation:dsh-account-statusbar-spin .8s linear infinite}
@keyframes dsh-account-statusbar-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dsh-account-statusbar__spinner{animation:none}}
`;

    /** Wallpaper-free glyph used before the label: a wallet outline. */
    const ICON = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        width: 12,
        height: 12,
        'aria-hidden': true,
        focusable: 'false',
        style: { flex: 'none', display: 'block' },
      },
      h('path', {
        d: 'M2.5 4.25h9.25a1.75 1.75 0 0 1 1.75 1.75v5.25a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 11.25V4.75A1.75 1.75 0 0 1 3.75 3h7.5',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: 11, cy: 8.75, r: 1, fill: 'currentColor' }),
    );

    /* ---------------------------------------------------------------- state */

    /**
     * @typedef {object} BalanceState
     * @property {'loading' | 'ready' | 'empty' | 'signed-out' | 'failed'} phase
     * @property {ReadonlyArray<{ currency: string, balance: string }>} wallets
     * @property {ReadonlyArray<{ currency: string, balance: string }>} bonusWallets
     * @property {boolean} refreshing
     * @property {string | null} error
     * @property {number} updatedAt
     */

    /** @type {BalanceState} */
    let state = {
      phase: 'loading',
      wallets: [],
      bonusWallets: [],
      refreshing: false,
      error: null,
      updatedAt: 0,
    };
    const listeners = new Set();

    /** @param {BalanceState} next - complete replacement snapshot. */
    function publish(next) {
      state = next;
      for (const listener of Array.from(listeners)) listener();
    }

    /** @param {() => void} listener - React subscription callback. */
    function subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }

    /** @returns {BalanceState} the current snapshot, stable between changes. */
    function getSnapshot() {
      return state;
    }

    /* ---------------------------------------------------------------- format */

    /**
     * Mirror Platform Web's currency display: two decimals, grouped digits, and
     * `<0.01` for a positive amount below one cent.
     * @param {string} amount - decimal string as Platform sent it.
     * @param {string} currency - ISO code from the wallet.
     * @returns {string} display text.
     */
    function formatMoney(amount, currency) {
      const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `;
      const value = Number(amount);
      if (!Number.isFinite(value)) return `${symbol}${amount}`;
      if (value !== 0 && Math.abs(value) < 0.01) return `<${symbol}0.01`;
      const sign = value < 0 ? '-' : '';
      const text = Math.abs(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `${sign}${symbol}${text}`;
    }

    /**
     * @param {ReadonlyArray<{ currency: string, balance: string }>} wallets - wallets to fold.
     * @returns {string} one text for the bar, currencies joined by a separator.
     */
    function formatWallets(wallets) {
      return wallets.map((wallet) => formatMoney(wallet.balance, wallet.currency)).join(' · ');
    }

    /**
     * @param {ReadonlyArray<{ currency: string, balance: string }>} wallets - bonus wallets.
     * @returns {boolean} whether any bonus credit is positive.
     */
    function hasBonus(wallets) {
      return wallets.some((wallet) => Number.isFinite(Number(wallet.balance)) && Number(wallet.balance) > 0);
    }

    /* ------------------------------------------------------------ account read */

    /** @returns {string} the Host release version the page is running. */
    function hostVersion() {
      const boot = globalThis.__DSH_BOOT__;
      const version = boot && boot.release && typeof boot.release.version === 'string' ? boot.release.version : '';
      return version.length > 0 ? version : FALLBACK_HOST_VERSION;
    }

    /**
     * Build the request identity every account Remote method carries.
     * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the locale service.
     * @returns {{ version: string, locale: string, timezoneOffsetSeconds: number }} metadata.
     */
    function clientMetadata(ctx) {
      const snapshot = ctx.locale.getSnapshot();
      const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : '';
      const locale = active.length > 0 ? active : document.documentElement.lang || 'zh';
      return {
        version: hostVersion(),
        locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      };
    }

    /**
     * Read the signed-in account's wallet balances.
     * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context carrying the account Remote.
     * @returns {Promise<unknown>} `null` when signed out, otherwise the balance outcome.
     */
    async function readBalance(ctx) {
      const result = await ctx.remote.account.getBalance(clientMetadata(ctx));
      if (result === undefined || result === null) throw new Error('account Remote returned no result');
      if (result.ok !== true) {
        const code = result.error && typeof result.error.code === 'string' ? result.error.code : 'unknown';
        throw new Error(code);
      }
      return result.value;
    }

    /* ------------------------------------------------------------ components */

    /**
     * The bar frame. Every item renders into the shared row, so the first item
     * keeps its place when more arrive.
     * @param {object} props - slot props: copy plus the injected store face.
     */
    function StatusBar({ t, subscribe: subscribeToStore, getSnapshot: readSnapshot, refresh }) {
      const snapshot = React.useSyncExternalStore(subscribeToStore, readSnapshot);

      const amount = formatWallets(snapshot.wallets);
      const showingAmount = snapshot.wallets.length > 0 && snapshot.phase !== 'signed-out';
      const valueTone = (() => {
        if (showingAmount) return snapshot.phase === 'failed' ? 'stale' : 'ready';
        if (snapshot.phase === 'failed') return 'failed';
        return 'muted';
      })();
      const valueText = (() => {
        if (showingAmount) return amount;
        if (snapshot.phase === 'signed-out') return t('signedOut');
        if (snapshot.phase === 'failed') return t('failed');
        if (snapshot.phase === 'empty') return t('empty');
        return t('loading');
      })();
      const stale = snapshot.phase === 'failed' && showingAmount;
      const title = [
        t('refresh'),
        snapshot.updatedAt > 0 ? `${t('updated')} ${new Date(snapshot.updatedAt).toLocaleTimeString()}` : null,
        snapshot.error !== null && snapshot.phase === 'failed' ? snapshot.error : null,
      ]
        .filter((part) => part !== null)
        .join(' · ');

      return h(
        'div',
        { className: 'dsh-account-statusbar', 'data-status-bar': true, 'aria-label': t('label') },
        h(
          'div',
          { className: 'dsh-account-statusbar__row' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-account-statusbar__item',
              title,
              'aria-busy': snapshot.refreshing ? 'true' : 'false',
              onClick: () => refresh(),
            },
            h('span', { className: 'dsh-account-statusbar__dot', 'data-tone': snapshot.phase }),
            h('span', { className: 'dsh-account-statusbar__label', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, ICON, t('label')),
            h('span', {
              className: 'dsh-account-statusbar__value',
              'data-tone': valueTone,
              'aria-live': 'polite',
            }, valueText),
            snapshot.refreshing ? h('span', { className: 'dsh-account-statusbar__spinner', 'aria-hidden': 'true' }) : null,
            hasBonus(snapshot.bonusWallets)
              ? h('span', { className: 'dsh-account-statusbar__bonus', title: t('bonus') }, `+${formatWallets(snapshot.bonusWallets)}`)
              : null,
          ),
        ),
        h('div', { className: 'dsh-account-statusbar__row' }),
      );
    }

    /* ---------------------------------------------------------------- apply */

    /** Services this browser half needs. */
    const inject = ['slots', 'locale', 'remote', 'remote.account'];

    /**
     * Install the bar and its one read loop.
     * @param {import('@deepseek-ai/cordis').Context} ctx - browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'account status bar: dictionaries');
      ctx.effect(() => {
        const tagId = '@local/dsh-account-statusbar/statusbar.css';
        if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {};
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-account-statusbar';
        tag.dataset.pluginCss = tagId;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'account status bar: styles');

      /** @type {Promise<void> | null} */
      let inFlight = null;

      /**
       * Read the balance once, sharing an in-flight read.
       * @param {{ force?: boolean }} [options] - `force` reads even while the tab is hidden.
       * @returns {Promise<void>} completion of this read.
       */
      const refresh = (options = {}) => {
        if (inFlight !== null) return inFlight;
        if (options.force !== true && document.visibilityState === 'hidden') return Promise.resolve();
        publish({
          ...state,
          phase: state.wallets.length > 0 ? state.phase : 'loading',
          refreshing: true,
          error: null,
        });
        inFlight = readBalance(ctx)
          .then((value) => {
            if (value === null || value === undefined) {
              publish({ phase: 'signed-out', wallets: [], bonusWallets: [], refreshing: false, error: null, updatedAt: Date.now() });
              return;
            }
            const outcome = value;
            if (outcome.status !== 'ready') {
              publish({
                phase: 'failed',
                wallets: state.wallets,
                bonusWallets: state.bonusWallets,
                refreshing: false,
                error: null,
                updatedAt: Date.now(),
              });
              return;
            }
            const wallets = Array.isArray(outcome.value) ? outcome.value : [];
            const bonusWallets = Array.isArray(outcome.bonusWallets) ? outcome.bonusWallets : [];
            publish({
              phase: wallets.length > 0 ? 'ready' : 'empty',
              wallets,
              bonusWallets,
              refreshing: false,
              error: null,
              updatedAt: Date.now(),
            });
          })
          .catch((error) => {
            publish({
              phase: 'failed',
              wallets: state.wallets,
              bonusWallets: state.bonusWallets,
              refreshing: false,
              error: error instanceof Error ? error.message : String(error),
              updatedAt: Date.now(),
            });
          })
          .finally(() => {
            inFlight = null;
          });
        return inFlight;
      };

      ctx.effect(() => {
        const first = setTimeout(() => {
          void refresh();
        }, FIRST_READ_MS);
        const onVisibility = () => {
          if (document.visibilityState === 'visible' && Date.now() - state.updatedAt > STALE_MS) void refresh();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
          clearTimeout(first);
          document.removeEventListener('visibilitychange', onVisibility);
        };
      }, 'account status bar: first read and tab return');

      ctx.effect(() => {
        const timer = setInterval(() => {
          void refresh();
        }, REFRESH_MS);
        return () => clearInterval(timer);
      }, 'account status bar: re-read timer');

      ctx.slots.inject('shell.bottom', () =>
        ctx.slots.register(
          {
            name: 'shell.bottom',
            id: 'account-balance',
            locale: NS,
            inject: () => ({
              subscribe,
              getSnapshot,
              refresh: () => {
                void refresh({ force: true });
              },
            }),
          },
          StatusBar,
        ),
      );
    }

    return { inject, apply };
  },
});
