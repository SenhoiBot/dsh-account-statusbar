/**
 * Host half of the account status bar.
 *
 * The status bar itself is browser code: the Client module system serves
 * `./client` to the page for every package that holds a Loader row, so this
 * entry exists to give the package that row and registers nothing on the Host.
 * Balance data comes from the shipped `account` Remote namespace, which already
 * owns the Platform grant and its HTTP calls.
 */

/** @param {import('@deepseek-ai/cordis').Context} _ctx - Host context held by the Loader row. */
export function apply(_ctx) {}
