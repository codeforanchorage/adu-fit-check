"""Build the DreamHost upload folder, the same way moa-bill does.

    python build_deploy.py                 build deploy_dreamhost/
    python build_deploy.py --verify [URL]  compare the live site with deploy_dreamhost/

deploy_dreamhost/ is gitignored and rebuilt from scratch on every run. It holds only the
files the site needs, so the whole folder is uploaded as it is. The upload itself is done
by hand (see the README-UPLOAD.txt this writes). No password or key is used here.
"""
import hashlib
import os
import shutil
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
DEPLOY = os.path.join(BASE, "deploy_dreamhost")
LIVE = "https://www.brendanbabb.com/experiments/adu-fit/"

# Everything the page loads from its own folder. Tests, package files and the work order
# stay out. If index.html or a module starts loading another local file, add it here.
FILES = ["index.html", "ui.js", "geometry.js", "rules.js", "data.js", "sun.js", "view3d.js", "config.js", "plans.json"]

# Files copied as they are, keeping their folder: the made-up sample surveys (tools/make_samples.py).
ASSETS = ["samples/sample-city-lot-alley.jpg", "samples/sample-corner-lot.jpg", "samples/sample-large-lot-septic.jpg"]

README = """How to put these on DreamHost
=============================

1) Upload everything in this folder into  experiments/adu-fit/  under the site's
   web directory:

     - Panel > Files > File Manager: drag the whole folder's contents in, or
     - SFTP/SSH:  scp -r index.html *.js plans.json samples README-UPLOAD.txt user@server.dreamhost.com:~/yourdomain.com/experiments/adu-fit/

   The page has no dependency on its location: every path in it is relative.
   It needs no PHP and no database.

2) Visit {live}
   Use https. "Copy summary" only works on a secure page.

3) Check the upload:  python build_deploy.py --verify
   It fetches each file from the live site and compares it with this folder.

What the page fetches from elsewhere, from the visitor's browser:
   - Municipality of Anchorage ArcGIS services (parcels, buildings, streets, alleys,
     seismic zones, flood areas, AWWU service) on services2.arcgis.com
   - Municipality of Anchorage aerial photos on www.ancgis.com, only when the
     visitor presses "Aerial photo"
   - Google Maps, only when the visitor follows the street view link (new tab)
   - the survey reader named in config.js (AWS), only when the visitor presses
     "Read survey with AI" on a survey they uploaded
   - Turf.js from cdn.jsdelivr.net, pdf.js from cdnjs.cloudflare.com
   - three.js from cdn.jsdelivr.net, only when the visitor presses "3D view"
   - fonts from fonts.googleapis.com

Updating later: regenerate (python build_deploy.py) and re-upload the changed
file(s).

Files and MD5 checksums in this build:
{sums}
"""


def md5(data):
    return hashlib.md5(data).hexdigest()


def build():
    # moa-bill's rule applies here too: nothing may hold deploy_dreamhost/ open.
    if os.path.isdir(DEPLOY):
        shutil.rmtree(DEPLOY)
    os.makedirs(DEPLOY)
    sums = []
    texts = {}
    for name in FILES:
        src = os.path.join(BASE, name)
        if not os.path.isfile(src):
            sys.exit(f"missing {name}")
        texts[name] = open(src, encoding="utf-8").read()
    # DreamHost tells browsers to keep .js files for 30 days and .html for 10 minutes. Without
    # a version on the script addresses, a returning visitor gets the new page with old
    # scripts. So every local script reference in the upload copy gets ?v=<stamp>, where the
    # stamp changes whenever any site file changes. The files in the repo are left as they are.
    stamp = md5("".join(texts[n] for n in FILES).encode("utf-8"))[:8]
    scripts = [n for n in FILES if n.endswith((".js", ".json"))]
    stamped = 0
    for name in FILES:
        text = texts[name]
        for other in scripts:
            for ref in ('"./' + other + '"', 'src="' + other + '"'):
                if ref in text:
                    text = text.replace(ref, ref[:-1] + "?v=" + stamp + '"')
                    stamped += 1
        open(os.path.join(DEPLOY, name), "w", encoding="utf-8", newline="\n").write(text)
        sums.append(f"   {md5(text.encode('utf-8'))}  {name}")
        # every local module the page imports must be in the upload
        for other in ("ui.js", "geometry.js", "rules.js", "data.js", "sun.js", "view3d.js", "config.js", "plans.json"):
            if ('"./' + other in text or 'src="' + other in text) and other not in FILES:
                sys.exit(f"{name} loads {other}, which is not in FILES")
    for name in ASSETS:
        src = os.path.join(BASE, name)
        if not os.path.isfile(src):
            sys.exit(f"missing {name}")
        os.makedirs(os.path.dirname(os.path.join(DEPLOY, name)), exist_ok=True)
        shutil.copyfile(src, os.path.join(DEPLOY, name))
        sums.append(f"   {md5(open(src, 'rb').read())}  {name}")
    if stamped < 11:
        sys.exit(f"only {stamped} script references were stamped; expected at least 11. Has the way scripts are loaded changed?")
    print(f"version stamp {stamp} on {stamped} script references")
    open(os.path.join(DEPLOY, "README-UPLOAD.txt"), "w", encoding="utf-8", newline="\n").write(
        README.format(live=LIVE, sums="\n".join(sums)))
    print(f"-> {DEPLOY}  ({len(FILES)} files, {len(ASSETS)} images + README-UPLOAD.txt)")
    print("\n".join(sums))
    print(f"\nUpload the folder's contents to experiments/adu-fit/, then run:  python build_deploy.py --verify")


def verify(url):
    if not url.endswith("/"):
        url += "/"
    if not os.path.isdir(DEPLOY):
        sys.exit("deploy_dreamhost/ does not exist. Run  python build_deploy.py  first.")
    bad = 0
    for name in FILES + ASSETS:
        local = md5(open(os.path.join(DEPLOY, name), "rb").read())
        try:
            req = urllib.request.Request(url + name, headers={"User-Agent": "adu-fit-check-deploy-check", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=30) as r:
                body, ctype = r.read(), r.headers.get("Content-Type", "")
        except Exception as e:  # noqa: BLE001
            print(f"  FAIL  {name}: {e}")
            bad += 1
            continue
        ok = md5(body) == local
        # browsers refuse a module script that is not served as JavaScript
        js_ok = not name.endswith(".js") or "javascript" in ctype.lower()
        print(f"  {'ok  ' if ok and js_ok else 'FAIL'}  {name}  {ctype}" + ("" if ok else "  differs from deploy_dreamhost/") + ("" if js_ok else "  not served as JavaScript"))
        bad += not (ok and js_ok)
    print(f"\n{url}: " + ("all files match." if not bad else f"{bad} file(s) wrong."))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if "--verify" in sys.argv:
        rest = [a for a in sys.argv[1:] if a != "--verify"]
        verify(rest[0] if rest else LIVE)
    else:
        build()
