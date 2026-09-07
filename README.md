# hll-stats

import zipfile, os, json, shutil, textwrap

src="/mnt/data/hll-stats-web.zip"
out="/mnt/data/hll-stats-github-pages.zip"
work="/mnt/data/hll-pages"
shutil.rmtree(work, ignore_errors=True)
os.makedirs(work)

with zipfile.ZipFile(src) as z:
    z.extractall(work)

root=os.path.join(work, "hll-stats-web")
public=os.path.join(root, "public")

# Make a static GitHub Pages version: use stats.json from the same repository.
app_js=os.path.join(public, "app.js")
with open(app_js, "r", encoding="utf-8") as f:
    js=f.read()

# Replace API fetch with static stats.json fetch.
import re
js=re.sub(r"""fetch\([^)]*?/api/stats[^)]*\)""", "fetch('./stats.json')", js)
js=js.replace("fetch('/api/stats')", "fetch('./stats.json')")
with open(app_js, "w", encoding="utf-8") as f:
    f.write(js)

# Remove server-only files and add GitHub Pages README.
for name in ["server.js", "package.json"]:
    p=os.path.join(root, name)
    if os.path.exists(p):
        os.remove(p)

readme="""# HLL Stats – GitHub Pages

Read-only HLL statistics website.

## GitHub Pages
Upload the contents of this folder to your GitHub repository and enable:
Settings → Pages → Deploy from a branch → main → / (root).

The website reads `stats.json` from the repository.

## Important
`stats.json` must be updated in the repository whenever the bot's statistics change.
The website itself contains no write functionality.
"""
with open(os.path.join(root, "README.md"), "w", encoding="utf-8") as f:
    f.write(readme)

# Create an empty/example stats.json if none exists.
stats_path=os.path.join(root, "stats.json")
if not os.path.exists(stats_path):
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump({}, f, indent=2, ensure_ascii=False)

# Put files at archive root, not nested.
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            full=os.path.join(dirpath, fn)
            arc=os.path.relpath(full, root)
            z.write(full, arc)

out
