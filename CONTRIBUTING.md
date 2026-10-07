# Contributing to FriendsInVoice

Thanks for wanting to help! FriendsInVoice is open source (GPL-3.0-or-later), and bug reports, ideas, translations and pull requests are all welcome.

## Ways to contribute

- **Report a bug**: [open a bug report](../../issues/new?template=bug_report.yml). Include your Discord branch (stable/PTB/canary), what you did, what you expected and what happened. Screenshots help, but please blur other people's names and avatars.
- **Suggest a feature**: [open a feature request](../../issues/new?template=feature_request.yml).
- **Improve the docs or translations**: the READMEs are [`README.md`](README.md) (English) and [`README.ar.md`](README.ar.md) (Arabic). Please keep both in sync when you change one.
- **Send code**: see below.

## Development setup

1. Install [Git](https://git-scm.com/), [Node.js](https://nodejs.org/) (LTS) and [pnpm](https://pnpm.io/) (`npm i -g pnpm`).
2. Set up Vencord from source, following the [Vencord install guide](https://docs.vencord.dev/installing/):
   ```bash
   git clone https://github.com/Vendicated/Vencord.git
   cd Vencord
   pnpm install --frozen-lockfile
   ```
3. Fork this repo, clone your fork, and copy (or symlink) the `friendsInVoice` folder into `Vencord/src/userplugins/`.
4. Build and patch Discord:
   ```bash
   pnpm build
   pnpm inject
   ```
   While developing, `pnpm build --watch` rebuilds on every save. Press `Ctrl+R` in Discord to reload.
5. Enable **FriendsInVoice** in Discord → Settings → Vencord → Plugins.

## Before opening a pull request

Run these from the Vencord folder and make sure they pass with no errors for the plugin:

```bash
pnpm exec tsc --noEmit
pnpm exec eslint src/userplugins/friendsInVoice
```

Then:

- Test your change in a real Discord client.
- Keep changes focused: one feature or fix per pull request.
- Match the existing code style (the Vencord ESLint config enforces most of it; run `eslint --fix`).
- Update both READMEs if you change anything users can see.
- Don't bump `VERSION` in `index.tsx`; the maintainer does that when cutting a release.

## Ground rules

- **Respect Discord's limits and other people's privacy.** The plugin only shows information Discord already gives your client. Please don't send features that try to get around Discord's privacy (for example hiding yourself in a voice room, or collecting data about people across servers you're not in).
- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [GPL-3.0-or-later](LICENSE), the same license as the project and as Vencord.
