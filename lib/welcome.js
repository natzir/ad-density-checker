// The welcome page: how to pin the extension and run a first test. It opens once, when the
// extension is first installed, not each time it, Chrome or a shared module updates.
export const WELCOME_PAGE = 'welcome.html';

export async function openWelcome(details, tabs) {
  if (details.reason === 'install') await tabs.create({ url: WELCOME_PAGE });
}
