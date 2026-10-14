# Contributing

Everyone taking part in the project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.

## Issues

Use [GitHub issues](https://github.com/wolfware-labs/cla-action/issues) for bugs and feature requests. For a bug, include the workflow file, the event that triggered the run, and the job log.

## Pull requests

1. Install Node.js 24 and run `npm ci`.
2. Change the TypeScript under `src/`.
3. Run `npm run build`. The action runs `dist/index.js`, so commit it together with the source change that produced it.
4. Open a pull request against `master` and describe the change and how you tested it.

Keep one change per pull request. Every commit must be signed.

## License

By contributing, you agree that your contributions are licensed under the [Apache License, Version 2.0](LICENSE).
