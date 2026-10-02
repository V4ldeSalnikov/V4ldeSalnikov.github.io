# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).


## OCR result publication

Audited hosted evaluations are stored in the OCR-eval repository under `results/`.
After regenerating the local-model snapshot and examples, merge the hosted reports:

```sh
python scripts/import_hosted_results.py --published-run ../OCR-eval/results/mistral_20261001 --published-run ../OCR-eval/results/gpt61_sol_full_20261002
```

This checks report and frozen-manifest hashes, preserves the existing models and images,
and adds predictions to the same deterministic comparison examples. Repeating the import
replaces those runs without duplicating results. The source bundles contain only public
result fields; API credentials, response headers, and local runtime paths stay outside Git.

```sh
node --test scripts/test_ocr_*.mjs
python -m unittest discover -s scripts -p "test_*.py"
npm run build
```
